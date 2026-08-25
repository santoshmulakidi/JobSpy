import type { AudioFrame } from '../../audio/audio-frame';
import type { CopilotMainEventValue } from '../../shared/contracts';
import type { TranscriptionAdapter } from '../../providers/stt/types';
import { createSttAdapter, type SttProviderId } from '../providers/provider-registry';
import { createNodeWebSocketFactory } from './node-websocket-factory';

export interface TranscriptionServiceOptions {
  readonly publish: (event: CopilotMainEventValue) => void;
  readonly createAdapter?: (providerId: SttProviderId, apiKey: string) => TranscriptionAdapter;
}

/**
 * Main-process speech-to-text session. Owns one live transcription adapter,
 * feeds captured PCM frames into it, and republishes transcripts as typed
 * renderer events. Raw audio never outlives the active session.
 */
export class TranscriptionService {
  private adapter: TranscriptionAdapter | null = null;
  private controller: AbortController | null = null;
  private consuming: Promise<void> | null = null;

  public constructor(private readonly options: TranscriptionServiceOptions) {}

  public get isActive(): boolean {
    return this.adapter !== null;
  }

  public async start(providerId: SttProviderId, apiKey: string): Promise<void> {
    if (this.adapter) await this.stop();

    const createAdapter = this.options.createAdapter
      ?? ((id: SttProviderId, key: string) => createSttAdapter(id, { apiKey: key, webSocketFactory: createNodeWebSocketFactory() }));
    const controller = new AbortController();
    const adapter = createAdapter(providerId, apiKey);
    this.controller = controller;
    this.adapter = adapter;

    try {
      await adapter.connect(controller.signal);
    } catch (error) {
      if (this.adapter === adapter) {
        this.adapter = null;
        this.controller = null;
      }
      throw error;
    }
    this.consuming = this.consumeEvents(adapter, controller);
  }

  /** Feeds one captured frame into the live adapter; failures never interrupt capture. */
  public handleFrame(frame: AudioFrame): void {
    const adapter = this.adapter;
    if (!adapter || this.controller?.signal.aborted) return;
    const pcm = new Uint8Array(frame.pcm.buffer, frame.pcm.byteOffset, frame.pcm.byteLength);
    try {
      adapter.sendAudio(pcm);
    } catch {
      // The consumer loop and stop() own recovery; dropping one frame is safe.
    }
  }

  public async stop(): Promise<void> {
    const adapter = this.adapter;
    const controller = this.controller;
    const consuming = this.consuming;
    this.adapter = null;
    this.controller = null;
    this.consuming = null;
    if (!adapter) return;

    controller?.abort();
    try {
      await adapter.close();
    } catch {
      // Closing is best effort; the provider socket may already be gone.
    }
    await consuming?.catch(() => undefined);
  }

  public dispose(): void {
    void this.stop();
  }

  private async consumeEvents(adapter: TranscriptionAdapter, controller: AbortController): Promise<void> {
    try {
      for await (const event of adapter.events()) {
        if (controller.signal.aborted) return;
        switch (event.type) {
          case 'partial':
            this.options.publish({ type: 'transcript-partial', text: event.text });
            break;
          case 'final':
            this.options.publish({ type: 'transcript-final', text: event.text });
            break;
          case 'error':
            this.options.publish({ type: 'transcript-failed', message: event.message });
            break;
          case 'closed':
            return;
          default:
            break;
        }
      }
    } catch {
      // Aborted connections are expected during stop; nothing to recover.
    } finally {
      controller.abort();
    }
  }
}
