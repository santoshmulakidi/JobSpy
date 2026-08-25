import type { AudioSource } from './audio-frame';
import type { BrowserCaptureConfig } from './browser-media-capture-host';
import type { RawAudioChunk } from './capture-controller';
import { CaptureHostCommandSchema, type CaptureStreamCommand } from './protocol';

export interface CaptureHost {
  start(
    config: BrowserCaptureConfig,
    onChunk: (chunk: RawAudioChunk) => void,
    onSourceLost: (source: AudioSource) => void,
  ): Promise<void>;
  stop(): void;
}

export interface CaptureRuntimePort {
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  off(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  off(event: 'close', listener: () => void): unknown;
  postMessage(message: CaptureStreamCommand): void;
  start(): void;
  close(): void;
}

export class AudioCaptureRuntime {
  private port: CaptureRuntimePort | null = null;
  private lifecycle: string | null = null;
  private credits = 0;
  private maxCredits = 0;
  private startupEpoch = 0;

  public constructor(private readonly host: CaptureHost) {}

  public connect(port: CaptureRuntimePort, lifecycle: string): void {
    this.disconnect(false);
    this.port = port;
    this.lifecycle = lifecycle;
    port.on('message', this.onMessage);
    port.on('close', this.onClose);
    port.start();
  }

  public disconnect(notify = true): void {
    const port = this.port;
    const lifecycle = this.lifecycle;
    this.startupEpoch += 1;
    this.host.stop();
    this.port = null;
    this.lifecycle = null;
    this.credits = 0;
    this.maxCredits = 0;
    if (port) {
      port.off('message', this.onMessage);
      port.off('close', this.onClose);
      if (notify && lifecycle) {
        port.postMessage({ type: 'capture-stopped', lifecycle });
      }
      port.close();
    }
  }

  private readonly onMessage = (event: { data: unknown }) => {
    const parsed = CaptureHostCommandSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.lifecycle !== this.lifecycle) {
      this.disconnect();
      return;
    }
    const command = parsed.data;
    switch (command.type) {
      case 'start-capture':
        const startupEpoch = this.startupEpoch += 1;
        const startupPort = this.port;
        const startupLifecycle = this.lifecycle;
        this.credits = command.credits;
        this.maxCredits = command.credits;
        void this.host.start(
          command.config,
          (chunk) => this.sendChunk(chunk),
          (source) => this.sendSourceLost(source),
        ).then(() => {
          if (
            startupEpoch === this.startupEpoch
            && startupPort === this.port
            && startupLifecycle === this.lifecycle
            && startupPort
            && startupLifecycle
          ) {
            startupPort.postMessage({ type: 'capture-ready', lifecycle: startupLifecycle });
          }
        }, () => {
          if (
            startupEpoch === this.startupEpoch
            && startupPort === this.port
            && startupLifecycle === this.lifecycle
            && startupPort
            && startupLifecycle
          ) {
            this.host.stop();
            startupPort.postMessage({
              type: 'capture-error',
              lifecycle: startupLifecycle,
              message: 'Audio capture failed.',
            });
          }
        });
        break;
      case 'capture-credit':
        this.credits = Math.min(this.maxCredits, this.credits + command.count);
        break;
      case 'stop-capture':
        this.disconnect();
        break;
    }
  };

  private readonly onClose = () => this.disconnect(false);

  private sendChunk(chunk: RawAudioChunk): void {
    try {
      if (!this.port || !this.lifecycle || this.credits <= 0) {
        return;
      }
      this.credits -= 1;
      this.port.postMessage({ type: 'audio-chunk', lifecycle: this.lifecycle, chunk });
    } finally {
      chunk.pcm.fill(0);
    }
  }

  private sendSourceLost(source: AudioSource): void {
    if (this.port && this.lifecycle) {
      this.port.postMessage({ type: 'source-lost', lifecycle: this.lifecycle, source });
    }
  }
}
