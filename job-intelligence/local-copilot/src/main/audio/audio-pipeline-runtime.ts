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

  public constructor(private readonly options: AudioPipelineRuntimeOptions) {}

  public async start(capture: AudioPipelineStartConfig): Promise<void> {
    if (this.child) {
      return;
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
      child.postMessage({ type: 'start', config });
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  public stop(): void {
    if (!this.child) {
      return;
    }
    this.expectedStop = true;
    this.options.permissionGate.revoke(this.lifecycle ?? undefined);
    this.child.postMessage({ type: 'stop' });
    this.child.kill();
    this.release();
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
      case 'error':
        this.fail(utilityMessage.message);
        break;
      case 'stopped':
        this.expectedStop = true;
        this.child?.kill();
        this.release();
        break;
      case 'ready':
      case 'source-lost':
      case 'frames-dropped':
        break;
    }
  };

  private readonly onExit = (code: number) => {
    const expected = this.expectedStop;
    this.release();
    if (!expected) {
      this.options.onFailure?.(`Audio utility exited with code ${code}.`);
    }
  };

  private fail(message: string): void {
    this.options.onFailure?.(message);
    this.stop();
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
