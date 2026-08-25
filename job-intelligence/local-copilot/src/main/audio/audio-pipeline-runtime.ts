import type { MessagePortMain, UtilityProcess, WebContents } from 'electron';
import { join } from 'node:path';

import type { AudioFrame } from '../../audio/audio-frame';
import type { CapturePermissionGate } from '../../audio/electron-loopback-handler';
import {
  AudioUtilityMessageSchema,
  type AudioUtilityConfig,
  type AudioUtilityMessage,
  zeroCandidatePcm,
} from '../../audio/protocol';

export interface AudioPipelinePort {
  on(event: 'message', listener: (event: { data: unknown; ports?: unknown[] }) => void): unknown;
  off(event: 'message', listener: (event: { data: unknown; ports?: unknown[] }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  off(event: 'close', listener: () => void): unknown;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

export interface UtilityChild {
  on(event: 'exit', listener: (code: number) => void): unknown;
  off(event: 'exit', listener: (code: number) => void): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  off(event: 'message', listener: (message: unknown) => void): unknown;
  postMessage(message: unknown, transfer?: AudioPipelinePort[]): void;
  kill(): boolean;
}

interface AudioPipelineRuntimeOptions {
  readonly captureWebContents: Pick<WebContents, 'id' | 'mainFrame' | 'postMessage'>;
  readonly permissionGate: CapturePermissionGate;
  readonly utilityEntryPath: string;
  readonly forkUtility: (entryPath: string) => UtilityChild;
  readonly createMessageChannel: () => { port1: AudioPipelinePort; port2: AudioPipelinePort };
  readonly createLifecycleId?: () => string;
  readonly onFrame?: (frame: AudioFrame) => void;
  readonly onSpeech?: (event: Extract<AudioUtilityMessage, { type: 'speech-start' | 'speech-end' }>) => void;
  readonly onFailure?: (message: string) => void;
  readonly stopTimeoutMs?: number;
  readonly scheduleStopTimeout?: (listener: () => void, delayMs: number) => unknown;
  readonly cancelStopTimeout?: (handle: unknown) => void;
}

export interface AudioPipelineStartConfig {
  readonly microphone: boolean;
  readonly systemAudio: boolean;
}

export interface AudioUtilityPathOptions {
  readonly isPackaged: boolean;
  readonly buildDirectory: string;
  readonly appPath: string;
}

export function resolveAudioUtilityEntry(options: AudioUtilityPathOptions): string {
  return options.isPackaged
    ? join(options.appPath, '.vite', 'build', 'audio-utility.js')
    : join(options.buildDirectory, 'audio-utility.js');
}

export class AudioPipelineRuntime {
  private child: UtilityChild | null = null;
  private lifecycle: string | null = null;
  private expectedStop = false;
  private stopPromise: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;
  private rejectStop: ((error: Error) => void) | null = null;
  private stopTimer: unknown;
  private startPromise: Promise<void> | null = null;
  private resolveStart: (() => void) | null = null;
  private rejectStart: ((error: Error) => void) | null = null;

  public constructor(private readonly options: AudioPipelineRuntimeOptions) {}

  public async start(capture: AudioPipelineStartConfig): Promise<void> {
    if (this.child) {
      return this.startPromise ?? Promise.resolve();
    }
    const lifecycle = this.options.createLifecycleId?.() ?? crypto.randomUUID();
    const child = this.options.forkUtility(this.options.utilityEntryPath);
    const { port1, port2 } = this.options.createMessageChannel();
    this.child = child;
    this.lifecycle = lifecycle;
    this.expectedStop = false;
    child.on('exit', this.onExit);
    child.on('message', this.onUtilityMessage);
    this.options.permissionGate.authorize(lifecycle);
    try {
      this.options.captureWebContents.postMessage(
        'audio:capture-port',
        { type: 'audio-capture-port', lifecycle },
        [port1 as MessagePortMain],
      );
      child.postMessage({ type: 'connect', lifecycle }, [port2]);
      const config: AudioUtilityConfig = {
        targetSampleRate: 24_000,
        maxBufferedFrames: 32,
        jitterWindowMs: 40,
        maxInFlightFrames: 4,
        vad: { threshold: 800, speechFrames: 2, silenceFrames: 8 },
        capture: {
          lifecycle,
          microphone: capture.microphone,
          systemAudio: capture.systemAudio,
          initialCredits: 32,
        },
      };
      this.startPromise = new Promise<void>((resolve, reject) => {
        this.resolveStart = resolve;
        this.rejectStart = reject;
      });
      const starting = this.startPromise;
      child.postMessage({ type: 'start', config });
      return starting;
    } catch (error) {
      this.clearStartPromise();
      this.abortFailedStart();
      throw error;
    }
  }

  public stop(): Promise<void> {
    if (!this.child) {
      return Promise.resolve();
    }
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.expectedStop = true;
    this.options.permissionGate.revoke(this.lifecycle ?? undefined);
    this.rejectStartup(new Error('Audio capture stopped before it became ready.'));
    this.stopPromise = new Promise<void>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    const stopping = this.stopPromise;
    try {
      this.child.postMessage({ type: 'stop' });
    } catch {
      this.forceStop();
      return stopping;
    }
    const schedule = this.options.scheduleStopTimeout
      ?? ((listener: () => void, delayMs: number) => setTimeout(listener, delayMs));
    this.stopTimer = schedule(() => this.forceStop(), this.options.stopTimeoutMs ?? 2_000);
    return stopping;
  }

  public isActive(): boolean {
    return this.child !== null;
  }

  private readonly onUtilityMessage = (message: unknown) => {
    const parsed = AudioUtilityMessageSchema.safeParse(message);
    if (!parsed.success) {
      zeroCandidatePcm(message);
      this.fail('Audio utility sent an invalid message.');
      return;
    }
    const utilityMessage = parsed.data;
    switch (utilityMessage.type) {
      case 'frame':
        try {
          this.options.onFrame?.(utilityMessage.frame);
        } finally {
          utilityMessage.frame.pcm.fill(0);
          this.child?.postMessage({ type: 'frame-ack', sequence: utilityMessage.frame.sequence });
        }
        break;
      case 'speech-start':
      case 'speech-end':
        this.options.onSpeech?.(utilityMessage);
        break;
      case 'capture-ready':
        if (utilityMessage.lifecycle === this.lifecycle) {
          this.resolveStart?.();
          this.clearStartPromise();
        }
        break;
      case 'capture-error':
        if (utilityMessage.lifecycle === this.lifecycle) {
          this.rejectStartup(new Error(utilityMessage.message));
          void this.stop();
        }
        break;
      case 'error':
        this.fail(utilityMessage.message);
        break;
      case 'stopped':
        break;
      case 'ready':
      case 'source-lost':
      case 'frames-dropped':
        break;
    }
  };

  private readonly onExit = (code: number) => {
    const expected = this.expectedStop;
    if (this.startPromise) {
      this.rejectStartup(new Error(`Audio utility exited before capture was ready with code ${code}.`));
    }
    this.release();
    if (expected) {
      this.completeStop();
    } else {
      this.options.onFailure?.(`Audio utility exited with code ${code}.`);
    }
  };

  private fail(message: string): void {
    this.rejectStartup(new Error(message));
    this.options.onFailure?.(message);
    void this.stop();
  }

  private forceStop(): void {
    if (!this.child) {
      this.completeStop();
      return;
    }
    if (!this.child.kill()) {
      const error = new Error('Audio utility did not stop.');
      this.options.onFailure?.(error.message);
      this.rejectStop?.(error);
      this.clearStopPromise();
    }
  }

  private abortFailedStart(): void {
    const child = this.child;
    this.expectedStop = true;
    this.options.permissionGate.revoke(this.lifecycle ?? undefined);
    if (child?.kill()) {
      this.release();
    }
  }

  private rejectStartup(error: Error): void {
    this.rejectStart?.(error);
    this.clearStartPromise();
  }

  private clearStartPromise(): void {
    this.startPromise = null;
    this.resolveStart = null;
    this.rejectStart = null;
  }

  private completeStop(): void {
    this.resolveStop?.();
    this.clearStopPromise();
  }

  private clearStopPromise(): void {
    if (this.stopTimer !== undefined) {
      const cancel = this.options.cancelStopTimeout ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
      cancel(this.stopTimer);
    }
    this.stopTimer = undefined;
    this.stopPromise = null;
    this.resolveStop = null;
    this.rejectStop = null;
  }

  private release(): void {
    const child = this.child;
    this.options.permissionGate.revoke(this.lifecycle ?? undefined);
    if (child) {
      child.off('exit', this.onExit);
      child.off('message', this.onUtilityMessage);
    }
    this.child = null;
    this.lifecycle = null;
  }
}

export function asUtilityChild(child: UtilityProcess): UtilityChild {
  return child as unknown as UtilityChild;
}
