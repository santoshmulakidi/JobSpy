import { transition, type SessionIntent, type SessionPhase } from './session-state';

export type { SessionIntent, SessionPhase } from './session-state';

export interface SessionError {
  readonly code: 'GENERATION_FAILED' | 'UTILITY_PROCESS_CRASHED';
  readonly message: string;
}

export interface GenerationSnapshot {
  readonly lifecycle: number;
  readonly requestId: string;
}

export interface SessionSnapshot {
  readonly phase: SessionPhase;
  readonly captureLifecycle: number | null;
  readonly generation: GenerationSnapshot | null;
  readonly pendingBufferBytes: number;
  readonly error: SessionError | null;
}

export type SessionEvent =
  | { readonly type: 'capture-started'; readonly snapshot: SessionSnapshot; readonly signal: AbortSignal }
  | { readonly type: 'capture-paused'; readonly snapshot: SessionSnapshot }
  | { readonly type: 'capture-resumed'; readonly snapshot: SessionSnapshot }
  | {
      readonly type: 'generation-started';
      readonly snapshot: SessionSnapshot;
      readonly signal: AbortSignal;
    }
  | {
      readonly type: 'generation-superseded';
      readonly snapshot: SessionSnapshot;
      readonly previousRequestId: string;
      readonly signal: AbortSignal;
    }
  | { readonly type: 'generation-completed'; readonly snapshot: SessionSnapshot; readonly requestId: string }
  | { readonly type: 'session-error'; readonly snapshot: SessionSnapshot; readonly error: SessionError }
  | { readonly type: 'capture-cancelled'; readonly snapshot: SessionSnapshot }
  | { readonly type: 'session-ended'; readonly snapshot: SessionSnapshot; readonly reason: 'stopped' };

export interface SessionControllerOptions {
  readonly createAbortController?: () => AbortController;
}

interface EventSubscriber {
  push(event: SessionEvent): void;
  close(): void;
}

class EventIterator implements AsyncIterator<SessionEvent>, EventSubscriber {
  private readonly queued: SessionEvent[] = [];
  private resolveNext: ((result: IteratorResult<SessionEvent>) => void) | null = null;
  private closed = false;

  public constructor(private readonly remove: () => void) {}

  public next(): Promise<IteratorResult<SessionEvent>> {
    const event = this.queued.shift();
    if (event) {
      return Promise.resolve({ done: false, value: event });
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => {
      this.resolveNext = resolve;
    });
  }

  public return(): Promise<IteratorResult<SessionEvent>> {
    this.close();
    return Promise.resolve({ done: true, value: undefined });
  }

  public push(event: SessionEvent): void {
    if (this.closed) {
      return;
    }
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      resolve({ done: false, value: event });
      return;
    }
    this.queued.push(event);
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.remove();
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      resolve({ done: true, value: undefined });
    }
  }
}

/** Coordinates session lifetimes only; it never persists or publishes raw capture data. */
export class SessionController {
  private phase: SessionPhase = 'idle';
  private captureLifecycle = 0;
  private generationLifecycle = 0;
  private captureAbortController: AbortController | null = null;
  private generationAbortController: AbortController | null = null;
  private activeGeneration: GenerationSnapshot | null = null;
  private error: SessionError | null = null;
  private pendingBuffers: Uint8Array[] = [];
  private readonly subscribers = new Set<EventSubscriber>();
  private readonly createAbortController: () => AbortController;

  public constructor(options: SessionControllerOptions = {}) {
    this.createAbortController = options.createAbortController ?? (() => new AbortController());
  }

  public dispatch(intent: SessionIntent): SessionSnapshot {
    const stateTransition = transition(this.phase, intent);
    if (!stateTransition.accepted || !this.matchesActiveGeneration(intent)) {
      return this.snapshot();
    }

    const previousGeneration = this.activeGeneration;
    this.phase = stateTransition.next;

    switch (intent.type) {
      case 'start':
        this.captureLifecycle += 1;
        this.captureAbortController = this.createAbortController();
        this.publish({ type: 'capture-started', snapshot: this.snapshot(), signal: this.captureAbortController.signal });
        break;
      case 'pause':
        this.publish({ type: 'capture-paused', snapshot: this.snapshot() });
        break;
      case 'resume':
        this.publish({ type: 'capture-resumed', snapshot: this.snapshot() });
        break;
      case 'generate': {
        this.abortGeneration();
        this.generationLifecycle += 1;
        this.generationAbortController = this.createAbortController();
        this.activeGeneration = { lifecycle: this.generationLifecycle, requestId: intent.requestId };
        const snapshot = this.snapshot();
        if (previousGeneration) {
          this.publish({
            type: 'generation-superseded',
            snapshot,
            previousRequestId: previousGeneration.requestId,
            signal: this.generationAbortController.signal,
          });
        } else {
          this.publish({ type: 'generation-started', snapshot, signal: this.generationAbortController.signal });
        }
        break;
      }
      case 'generation-completed':
        this.activeGeneration = null;
        this.generationAbortController = null;
        this.publish({ type: 'generation-completed', snapshot: this.snapshot(), requestId: intent.requestId });
        break;
      case 'generation-failed':
        this.abortCapture();
        this.abortGeneration();
        this.clearPendingBuffers();
        this.error = { code: 'GENERATION_FAILED', message: intent.message };
        this.publish({ type: 'session-error', snapshot: this.snapshot(), error: this.error });
        break;
      case 'utility-process-crashed':
        this.abortCapture();
        this.abortGeneration();
        this.clearPendingBuffers();
        this.error = { code: 'UTILITY_PROCESS_CRASHED', message: intent.message };
        this.publish({ type: 'session-error', snapshot: this.snapshot(), error: this.error });
        break;
      case 'buffer-pending':
        this.pendingBuffers.push(new Uint8Array(intent.bytes));
        break;
      case 'stop':
        this.abortCapture();
        this.abortGeneration();
        this.clearPendingBuffers();
        this.error = null;
        this.publish({ type: 'capture-cancelled', snapshot: this.snapshot() });
        this.publish({ type: 'session-ended', snapshot: this.snapshot(), reason: 'stopped' });
        this.closeSubscribers();
        break;
    }

    return this.snapshot();
  }

  public events(): AsyncIterable<SessionEvent> {
    const iterator = new EventIterator(() => this.subscribers.delete(iterator));
    if (this.phase === 'stopped') {
      iterator.close();
    } else {
      this.subscribers.add(iterator);
    }
    return {
      [Symbol.asyncIterator]: () => iterator,
    };
  }

  private matchesActiveGeneration(intent: SessionIntent): boolean {
    if (intent.type !== 'generation-completed' && intent.type !== 'generation-failed') {
      return true;
    }
    return this.activeGeneration?.requestId === intent.requestId;
  }

  private abortCapture(): void {
    this.captureAbortController?.abort();
    this.captureAbortController = null;
  }

  private abortGeneration(): void {
    this.generationAbortController?.abort();
    this.generationAbortController = null;
    this.activeGeneration = null;
  }

  private clearPendingBuffers(): void {
    for (const buffer of this.pendingBuffers) {
      buffer.fill(0);
    }
    this.pendingBuffers = [];
  }

  public snapshot(): SessionSnapshot {
    return {
      phase: this.phase,
      captureLifecycle: this.captureAbortController ? this.captureLifecycle : null,
      generation: this.activeGeneration ? { ...this.activeGeneration } : null,
      pendingBufferBytes: this.pendingBuffers.reduce((total, buffer) => total + buffer.byteLength, 0),
      error: this.error ? { ...this.error } : null,
    };
  }

  private publish(event: SessionEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber.push(event);
    }
  }

  private closeSubscribers(): void {
    for (const subscriber of [...this.subscribers]) {
      subscriber.close();
    }
  }
}
