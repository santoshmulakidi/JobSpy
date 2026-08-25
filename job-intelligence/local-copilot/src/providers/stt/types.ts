export type TranscriptEvent =
  | { readonly type: 'partial'; readonly text: string }
  | { readonly type: 'final'; readonly text: string }
  | { readonly type: 'speech-start' }
  | { readonly type: 'speech-end' }
  | {
      readonly type: 'error';
      readonly code: 'authentication' | 'quota' | 'provider' | 'invalid-event';
      readonly message: string;
      readonly retryable: boolean;
    }
  | { readonly type: 'closed' };

export interface TranscriptionAdapter {
  connect(signal?: AbortSignal): Promise<void>;
  sendAudio(audio: Uint8Array): void;
  events(): AsyncIterable<TranscriptEvent>;
  close(): Promise<void>;
}

type SocketEvent = 'open' | 'message' | 'close' | 'error';
type SocketListener = (event: unknown) => void;

export interface SttWebSocket {
  readonly readyState: number;
  addEventListener(type: SocketEvent, listener: SocketListener): void;
  removeEventListener(type: SocketEvent, listener: SocketListener): void;
  send(data: string | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export interface WebSocketConnection {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type WebSocketFactory = (connection: WebSocketConnection) => SttWebSocket;

export interface StreamingAdapterOptions {
  readonly connection: WebSocketConnection;
  readonly webSocketFactory: WebSocketFactory;
  readonly encodeAudio: (audio: Uint8Array) => string | ArrayBufferView;
  readonly parseEvent: (event: unknown) => TranscriptEvent[];
  readonly classifyClose: (code: number, reason: string) => Extract<TranscriptEvent, { type: 'error' }>;
  readonly closeMessage?: string;
  readonly reset?: () => void;
}

interface SocketBinding {
  expectedClose: boolean;
  readonly signal?: AbortSignal;
  onAbort?: () => void;
  readonly onOpen: SocketListener;
  readonly onMessage: SocketListener;
  readonly onClose: SocketListener;
  readonly onError: SocketListener;
}

export class StreamingTranscriptionAdapter implements TranscriptionAdapter {
  private socket: SttWebSocket | null = null;
  private binding: SocketBinding | null = null;
  private connectPromise: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;
  private readonly queuedAudio: Uint8Array[] = [];
  private readonly eventQueue: TranscriptEvent[] = [];
  private readonly eventWaiters: Array<(event: IteratorResult<TranscriptEvent>) => void> = [];

  public constructor(private readonly options: StreamingAdapterOptions) {}

  public connect(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.socket?.readyState === 1) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.options.reset?.();
    const socket = this.options.webSocketFactory(this.options.connection);
    this.socket = socket;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    const connecting = this.connectPromise;
    const binding: SocketBinding = {
      expectedClose: false,
      signal,
      onOpen: () => {
        if (this.socket !== socket) return;
        try {
          this.flushAudio(socket);
          this.resolveConnect?.();
          this.clearConnectPromise();
        } catch (error) {
          this.rejectConnecting(asError(error));
          this.disconnect(socket, 1011, 'audio send failed');
        }
      },
      onMessage: (event) => {
        if (this.socket !== socket) return;
        const data = isRecord(event) ? event.data : undefined;
        let normalized: TranscriptEvent[];
        try {
          if (typeof data !== 'string') throw new Error('Provider event was not text.');
          normalized = this.options.parseEvent(JSON.parse(data));
        } catch {
          normalized = [invalidEvent()];
        }
        for (const item of normalized) this.push(item);
        if (normalized.some(({ type }) => type === 'error')) {
          this.disconnect(socket, 1002, 'invalid provider event');
        }
      },
      onClose: (event) => {
        if (this.socket !== socket) return;
        const code = isRecord(event) && typeof event.code === 'number' ? event.code : 1006;
        const reason = isRecord(event) && typeof event.reason === 'string' ? event.reason : '';
        if (!binding.expectedClose && code !== 1000) {
          this.push(this.options.classifyClose(code, reason));
        }
        this.rejectConnecting(new Error(reason || `WebSocket closed with code ${code}.`));
        this.release(socket);
        this.push({ type: 'closed' });
      },
      onError: (event) => {
        if (this.socket !== socket) return;
        const message = isRecord(event) && typeof event.message === 'string'
          ? event.message
          : 'WebSocket connection failed.';
        this.rejectConnecting(new Error(message));
      },
    };
    binding.onAbort = signal
      ? () => {
          if (this.socket !== socket) return;
          this.rejectConnecting(abortError());
          this.disconnect(socket, 1000, 'cancelled');
        }
      : undefined;
    this.binding = binding;
    socket.addEventListener('open', binding.onOpen);
    socket.addEventListener('message', binding.onMessage);
    socket.addEventListener('close', binding.onClose);
    socket.addEventListener('error', binding.onError);
    signal?.addEventListener('abort', binding.onAbort!, { once: true });
    return connecting;
  }

  public sendAudio(audio: Uint8Array): void {
    const owned = audio.slice();
    audio.fill(0);
    const socket = this.socket;
    if (!socket) {
      owned.fill(0);
      throw new Error('Transcription adapter is not connected.');
    }
    if (socket.readyState === 0) {
      this.queuedAudio.push(owned);
      return;
    }
    if (socket.readyState !== 1) {
      owned.fill(0);
      throw new Error('Transcription socket is not open.');
    }
    this.sendOwned(socket, owned);
  }

  public events(): AsyncIterable<TranscriptEvent> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          const event = this.eventQueue.shift();
          return event
            ? Promise.resolve({ done: false as const, value: event })
            : new Promise<IteratorResult<TranscriptEvent>>((resolve) => this.eventWaiters.push(resolve));
        },
      }),
    };
  }

  public close(): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      this.zeroQueuedAudio();
      return Promise.resolve();
    }
    if (socket.readyState === 1 && this.options.closeMessage) socket.send(this.options.closeMessage);
    this.disconnect(socket, 1000, 'client close');
    return Promise.resolve();
  }

  private flushAudio(socket: SttWebSocket): void {
    while (this.queuedAudio.length > 0) this.sendOwned(socket, this.queuedAudio.shift()!);
  }

  private sendOwned(socket: SttWebSocket, audio: Uint8Array): void {
    try {
      socket.send(this.options.encodeAudio(audio));
    } finally {
      audio.fill(0);
    }
  }

  private disconnect(socket: SttWebSocket, code: number, reason: string): void {
    if (this.socket !== socket) return;
    if (this.binding) this.binding.expectedClose = true;
    socket.close(code, reason);
    if (this.socket === socket) {
      this.release(socket);
      this.push({ type: 'closed' });
    }
  }

  private release(socket: SttWebSocket): void {
    const binding = this.binding;
    if (binding) {
      socket.removeEventListener('open', binding.onOpen);
      socket.removeEventListener('message', binding.onMessage);
      socket.removeEventListener('close', binding.onClose);
      socket.removeEventListener('error', binding.onError);
      if (binding.signal && binding.onAbort) binding.signal.removeEventListener('abort', binding.onAbort);
    }
    this.zeroQueuedAudio();
    this.socket = null;
    this.binding = null;
  }

  private zeroQueuedAudio(): void {
    for (const audio of this.queuedAudio) audio.fill(0);
    this.queuedAudio.length = 0;
  }

  private push(event: TranscriptEvent): void {
    const waiter = this.eventWaiters.shift();
    if (waiter) waiter({ done: false, value: event });
    else this.eventQueue.push(event);
  }

  private rejectConnecting(error: Error): void {
    this.rejectConnect?.(error);
    this.clearConnectPromise();
  }

  private clearConnectPromise(): void {
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
  }
}

export function providerError(
  code: Extract<TranscriptEvent, { type: 'error' }>['code'],
  message: string,
  retryable = false,
): Extract<TranscriptEvent, { type: 'error' }> {
  return { type: 'error', code, message, retryable };
}

export function invalidEvent(): Extract<TranscriptEvent, { type: 'error' }> {
  return providerError('invalid-event', 'Provider sent an invalid transcription event.');
}

function abortError(): Error {
  return new DOMException('The transcription connection was cancelled.', 'AbortError');
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
