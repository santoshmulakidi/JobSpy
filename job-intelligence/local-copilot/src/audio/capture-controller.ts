import { createAudioFrame, type AudioFrame, type AudioSource } from './audio-frame';
import { resamplePcm16Mono } from './resampler';

export interface RawAudioChunk {
  readonly source: AudioSource;
  readonly capturedAt: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly pcm: Int16Array;
}

export interface CaptureConfig {
  readonly targetSampleRate: number;
  readonly maxBufferedFrames: number;
  readonly jitterWindowMs: number;
  readonly memoryOnly?: boolean;
}

export type CaptureEvent = { readonly type: 'source-lost'; readonly source: AudioSource };

export interface CaptureStatus {
  readonly active: boolean;
  readonly memoryOnly: true;
  readonly bufferedFrames: number;
  readonly droppedFrames: number;
  readonly lostSources: AudioSource[];
}

interface BufferedChunk {
  readonly arrival: number;
  readonly source: AudioSource;
  readonly capturedAt: number;
  readonly pcm: Int16Array;
}

interface Subscriber<T> {
  push(value: T): void;
  close(): void;
}

class AsyncQueue<T> implements AsyncIterator<T>, Subscriber<T> {
  private readonly queued: T[] = [];
  private waiting: ((result: IteratorResult<T>) => void) | null = null;
  private closed = false;

  public constructor(
    private readonly remove: () => void,
    private readonly capacity = Number.POSITIVE_INFINITY,
    private readonly dispose: (value: T) => void = () => undefined,
    private readonly onDrop: () => void = () => undefined,
  ) {}

  public next(): Promise<IteratorResult<T>> {
    const value = this.queued.shift();
    if (value !== undefined) {
      return Promise.resolve({ done: false, value });
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  public return(): Promise<IteratorResult<T>> {
    this.close();
    return Promise.resolve({ done: true, value: undefined });
  }

  public push(value: T): void {
    if (this.closed) {
      return;
    }
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ done: false, value });
    } else {
      if (this.queued.length >= this.capacity) {
        const dropped = this.queued.shift();
        if (dropped !== undefined) {
          this.dispose(dropped);
          this.onDrop();
        }
      }
      this.queued.push(value);
    }
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const value of this.queued.splice(0)) {
      this.dispose(value);
    }
    this.remove();
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ done: true, value: undefined });
    }
  }
}

export class CaptureController {
  private config: CaptureConfig | null = null;
  private active = false;
  private nextSequence = 0;
  private nextArrival = 0;
  private droppedFrames = 0;
  private readonly buffered: BufferedChunk[] = [];
  private readonly lostSources = new Set<AudioSource>();
  private readonly frameSubscribers = new Set<Subscriber<AudioFrame>>();
  private readonly eventSubscribers = new Set<Subscriber<CaptureEvent>>();

  public start(config: CaptureConfig): void {
    if (config.memoryOnly === false) {
      throw new Error('Raw audio persistence requires an explicit recording writer.');
    }
    if (config.targetSampleRate <= 0 || config.maxBufferedFrames <= 0 || config.jitterWindowMs < 0) {
      throw new RangeError('Capture configuration values are outside their valid range.');
    }
    this.stop();
    this.config = { ...config, memoryOnly: true };
    this.active = true;
    this.nextSequence = 0;
    this.nextArrival = 0;
    this.droppedFrames = 0;
    this.lostSources.clear();
  }

  public accept(chunk: RawAudioChunk): void {
    if (!this.active || !this.config) {
      throw new Error('Capture must be started before accepting audio.');
    }
    if (!Number.isFinite(chunk.capturedAt)) {
      throw new RangeError('Capture timestamp must be finite.');
    }
    const normalized = resamplePcm16Mono(
      chunk.pcm,
      chunk.sampleRate,
      chunk.channels,
      this.config.targetSampleRate,
    );
    if (normalized !== chunk.pcm) {
      chunk.pcm.fill(0);
    }
    this.buffered.push({
      arrival: this.nextArrival,
      source: chunk.source,
      capturedAt: chunk.capturedAt,
      pcm: normalized,
    });
    this.nextArrival += 1;
    this.sortBuffered();
    while (this.buffered.length > this.config.maxBufferedFrames) {
      const dropped = this.buffered.shift();
      dropped?.pcm.fill(0);
      this.droppedFrames += 1;
    }
    this.releaseJitteredFrames();
  }

  public sourceLost(source: AudioSource): void {
    if (!this.active || this.lostSources.has(source)) {
      return;
    }
    this.lostSources.add(source);
    this.publish(this.eventSubscribers, { type: 'source-lost', source });
    this.flushBuffered();
  }

  public frames(): AsyncIterable<AudioFrame> {
    const queue = new AsyncQueue<AudioFrame>(
      () => this.frameSubscribers.delete(queue),
      this.config?.maxBufferedFrames ?? 1,
      (frame) => frame.pcm.fill(0),
      () => { this.droppedFrames += 1; },
    );
    if (!this.active) {
      queue.close();
    } else {
      this.frameSubscribers.add(queue);
    }
    return { [Symbol.asyncIterator]: () => queue };
  }

  public events(): AsyncIterable<CaptureEvent> {
    const queue = new AsyncQueue<CaptureEvent>(() => this.eventSubscribers.delete(queue));
    if (!this.active) {
      queue.close();
    } else {
      this.eventSubscribers.add(queue);
    }
    return { [Symbol.asyncIterator]: () => queue };
  }

  public status(): CaptureStatus {
    return {
      active: this.active,
      memoryOnly: true,
      bufferedFrames: this.buffered.length,
      droppedFrames: this.droppedFrames,
      lostSources: [...this.lostSources].sort(),
    };
  }

  public stop(): void {
    for (const chunk of this.buffered) {
      chunk.pcm.fill(0);
    }
    this.buffered.length = 0;
    this.active = false;
    for (const subscriber of [...this.frameSubscribers]) {
      subscriber.close();
    }
    for (const subscriber of [...this.eventSubscribers]) {
      subscriber.close();
    }
  }

  private sortBuffered(): void {
    this.buffered.sort((left, right) =>
      left.capturedAt - right.capturedAt
      || left.source.localeCompare(right.source)
      || left.arrival - right.arrival);
  }

  private releaseJitteredFrames(): void {
    if (!this.config || this.buffered.length === 0) {
      return;
    }
    const newestTimestamp = Math.max(...this.buffered.map(({ capturedAt }) => capturedAt));
    while (
      this.buffered.length > 0
      && newestTimestamp - (this.buffered[0]?.capturedAt ?? newestTimestamp) >= this.config.jitterWindowMs
    ) {
      this.releaseOne();
      if (this.config.jitterWindowMs === 0 && this.buffered.length === 0) {
        break;
      }
    }
  }

  private flushBuffered(): void {
    while (this.buffered.length > 0) {
      this.releaseOne();
    }
  }

  private releaseOne(): void {
    if (!this.config) {
      return;
    }
    const chunk = this.buffered.shift();
    if (!chunk) {
      return;
    }
    const frame = createAudioFrame({
      source: chunk.source,
      sequence: this.nextSequence,
      capturedAt: chunk.capturedAt,
      sampleRate: this.config.targetSampleRate,
      channels: 1,
      pcm: chunk.pcm,
    });
    this.nextSequence += 1;
    if (this.frameSubscribers.size === 0) {
      frame.pcm.fill(0);
      this.droppedFrames += 1;
      return;
    }
    this.publish(this.frameSubscribers, frame);
  }

  private publish<T>(subscribers: Set<Subscriber<T>>, value: T): void {
    for (const subscriber of subscribers) {
      subscriber.push(value);
    }
  }
}
