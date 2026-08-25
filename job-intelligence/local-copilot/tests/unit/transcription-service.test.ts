import { describe, expect, it } from 'vitest';

import type { AudioFrame } from '../../src/audio/audio-frame';
import { TranscriptionService } from '../../src/main/transcription/transcription-service';
import type { CopilotMainEventValue } from '../../src/shared/contracts';
import type { TranscriptEvent, TranscriptionAdapter } from '../../src/providers/stt/types';

class FakeAdapter implements TranscriptionAdapter {
  public readonly sent: Uint8Array[] = [];
  public closed = false;
  private queue: TranscriptEvent[] = [];
  private waiters: Array<(result: IteratorResult<TranscriptEvent>) => void> = [];

  public constructor(private readonly connectError?: Error) {}

  public async connect(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || this.connectError) {
      throw this.connectError ?? new DOMException('The transcription connection was cancelled.', 'AbortError');
    }
  }

  public sendAudio(audio: Uint8Array): void {
    this.sent.push(audio.slice());
    audio.fill(0);
  }

  public events(): AsyncIterable<TranscriptEvent> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          const event = this.queue.shift();
          if (event) return Promise.resolve({ done: false as const, value: event });
          return new Promise<IteratorResult<TranscriptEvent>>((resolve) => this.waiters.push(resolve));
        },
      }),
    };
  }

  public push(event: TranscriptEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value: event });
    else this.queue.push(event);
  }

  public async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.push({ type: 'closed' });
    }
  }
}

function frame(sequence = 0): AudioFrame & { pcm: Int16Array } {
  return {
    source: 'microphone',
    sequence,
    capturedAt: Date.now(),
    sampleRate: 24_000,
    channels: 1,
    pcm: new Int16Array([1, -2, 3]),
  };
}

async function settle(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('TranscriptionService', () => {
  it('maps provider events onto typed renderer events and ignores speech markers', async () => {
    const adapter = new FakeAdapter();
    const events: CopilotMainEventValue[] = [];
    const service = new TranscriptionService({
      publish: (event) => events.push(event),
      createAdapter: () => adapter,
    });

    await service.start('deepgram', 'dg-key');
    adapter.push({ type: 'speech-start' });
    adapter.push({ type: 'partial', text: 'What is the' });
    adapter.push({ type: 'final', text: 'What is the notice period?' });
    await settle();

    expect(events).toEqual([
      { type: 'transcript-partial', text: 'What is the' },
      { type: 'transcript-final', text: 'What is the notice period?' },
    ]);
    expect(JSON.stringify(events)).not.toContain('dg-key');

    await service.stop();
  });

  it('feeds little-endian pcm frames to the live adapter and survives socket throws', async () => {
    const adapter = new FakeAdapter();
    const service = new TranscriptionService({
      publish: () => undefined,
      createAdapter: () => adapter,
    });
    await service.start('deepgram', 'dg-key');

    const captured = frame();
    service.handleFrame(captured);
    expect(adapter.sent).toHaveLength(1);
    expect([...adapter.sent[0]!]).toEqual([1, 0, 254, 255, 3, 0]);
    expect([...captured.pcm]).toEqual([0, 0, 0]);

    adapter.sendAudio = () => {
      throw new Error('Transcription socket is not open.');
    };
    expect(() => service.handleFrame(frame(1))).not.toThrow();

    await service.stop();
    expect(service.isActive).toBe(false);
  });

  it('ignores frames when idle', async () => {
    const adapter = new FakeAdapter();
    const service = new TranscriptionService({
      publish: () => undefined,
      createAdapter: () => adapter,
    });

    expect(() => service.handleFrame(frame())).not.toThrow();
    expect(adapter.sent).toHaveLength(0);
  });

  it('propagates connect failures without keeping state', async () => {
    const failing = new FakeAdapter(new Error('WebSocket closed with code 401.'));
    const healthy = new FakeAdapter();
    const adapters = [failing, healthy];
    let index = 0;
    const service = new TranscriptionService({
      publish: () => undefined,
      createAdapter: () => adapters[index++]!,
    });

    await expect(service.start('elevenlabs', 'bad-key')).rejects.toThrow('401');
    expect(service.isActive).toBe(false);

    await service.start('deepgram', 'good-key');
    expect(service.isActive).toBe(true);
    await service.stop();
  });

  it('publishes provider errors as transcript failures', async () => {
    const adapter = new FakeAdapter();
    const events: CopilotMainEventValue[] = [];
    const service = new TranscriptionService({
      publish: (event) => events.push(event),
      createAdapter: () => adapter,
    });
    await service.start('deepgram', 'dg-key');

    adapter.push({ type: 'error', code: 'quota', message: 'Provider quota exceeded.', retryable: true });
    await settle();

    expect(events).toEqual([{ type: 'transcript-failed', message: 'Provider quota exceeded.' }]);
    await service.stop();
  });

  it('stops cleanly while waiting for events and closes the adapter once', async () => {
    const adapter = new FakeAdapter();
    const service = new TranscriptionService({
      publish: () => undefined,
      createAdapter: () => adapter,
    });
    await service.start('deepgram', 'dg-key');

    const stopping = service.stop();
    await stopping;
    expect(adapter.closed).toBe(true);
    expect(service.isActive).toBe(false);
    await expect(service.stop()).resolves.toBeUndefined();
  });

  it('restarts a fresh adapter on a second start', async () => {
    const first = new FakeAdapter();
    const second = new FakeAdapter();
    const adapters = [first, second];
    let index = 0;
    const service = new TranscriptionService({
      publish: () => undefined,
      createAdapter: () => adapters[index++]!,
    });

    await service.start('deepgram', 'key-one');
    await service.start('deepgram', 'key-two');
    await settle();

    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(service.isActive).toBe(true);
    await service.stop();
  });
});
