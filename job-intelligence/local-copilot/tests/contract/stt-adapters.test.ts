import { describe, expect, it } from 'vitest';

import { createDeepgramAdapter } from '../../src/providers/stt/deepgram';
import { createElevenLabsAdapter } from '../../src/providers/stt/elevenlabs';
import type {
  SttWebSocket,
  TranscriptEvent,
  WebSocketConnection,
  WebSocketFactory,
} from '../../src/providers/stt/types';

type SocketEvent = 'open' | 'message' | 'close' | 'error';
type SocketListener = (event: unknown) => void;

class FakeWebSocket implements SttWebSocket {
  public readyState = 0;
  public readonly sent: Array<string | Uint8Array> = [];
  public closeCalls = 0;
  private readonly listeners = new Map<SocketEvent, Set<SocketListener>>();

  public addEventListener(type: SocketEvent, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(type: SocketEvent, listener: SocketListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  public send(data: string | ArrayBufferView): void {
    this.sent.push(typeof data === 'string'
      ? data
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
  }

  public close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.closeCalls += 1;
    this.readyState = 3;
    this.emit('close', { code, reason, wasClean: code === 1000 });
  }

  public open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  public message(message: unknown): void {
    this.emit('message', { data: typeof message === 'string' ? message : JSON.stringify(message) });
  }

  public serverClose(code: number, reason: string): void {
    this.readyState = 3;
    this.emit('close', { code, reason, wasClean: false });
  }

  private emit(type: SocketEvent, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function fakeSockets() {
  const requests: WebSocketConnection[] = [];
  const sockets: FakeWebSocket[] = [];
  const factory: WebSocketFactory = (request) => {
    requests.push(request);
    const socket = new FakeWebSocket();
    sockets.push(socket);
    return socket;
  };
  return { factory, requests, sockets };
}

async function nextEvent(events: AsyncIterator<TranscriptEvent>): Promise<TranscriptEvent> {
  const result = await events.next();
  if (result.done) throw new Error('Expected a transcription event.');
  return result.value;
}

interface AdapterFixture {
  readonly name: string;
  create(factory: WebSocketFactory): ReturnType<typeof createDeepgramAdapter>;
  emitTranscript(socket: FakeWebSocket): void;
  emitError(socket: FakeWebSocket, kind: 'authentication' | 'quota'): void;
  expectConnection(request: WebSocketConnection): void;
  expectAudio(sent: string | Uint8Array): void;
  expectClose(sent: Array<string | Uint8Array>): void;
}

const fixtures: AdapterFixture[] = [
  {
    name: 'Deepgram Nova',
    create: (factory) => createDeepgramAdapter({ apiKey: 'secret-key', webSocketFactory: factory }),
    emitTranscript: (socket) => {
      socket.message({ type: 'SpeechStarted', channel: [0], timestamp: 0 });
      socket.message({
        type: 'Results',
        is_final: false,
        speech_final: false,
        channel: { alternatives: [{ transcript: 'hello wor' }] },
      });
      socket.message({
        type: 'Results',
        is_final: true,
        speech_final: false,
        channel: { alternatives: [{ transcript: 'hello world' }] },
      });
      socket.message({ type: 'UtteranceEnd', channel: [0], last_word_end: 1.2 });
    },
    emitError: (socket, kind) => socket.serverClose(
      1008,
      kind === 'authentication' ? 'INVALID_AUTH' : 'ASR_PAYMENT_REQUIRED',
    ),
    expectConnection: ({ url, headers }) => {
      expect(url).toContain('model=nova-3');
      expect(url).toContain('endpointing=300');
      expect(url).toContain('utterance_end_ms=1000');
      expect(url).not.toContain('secret-key');
      expect(headers).toEqual({ Authorization: 'Token secret-key' });
    },
    expectAudio: (sent) => expect(sent).toEqual(new Uint8Array([1, 2, 3])),
    expectClose: (sent) => expect(sent).toContain(JSON.stringify({ type: 'CloseStream' })),
  },
  {
    name: 'ElevenLabs Scribe v2 Realtime',
    create: (factory) => createElevenLabsAdapter({ apiKey: 'secret-key', webSocketFactory: factory }),
    emitTranscript: (socket) => {
      socket.message({ message_type: 'partial_transcript', text: 'hello wor' });
      socket.message({ message_type: 'committed_transcript', text: 'hello world' });
    },
    emitError: (socket, kind) => socket.message({
      message_type: kind === 'authentication' ? 'auth_error' : 'quota_exceeded',
      error: `${kind} failed`,
    }),
    expectConnection: ({ url, headers }) => {
      expect(url).toContain('model_id=scribe_v2_realtime');
      expect(url).toContain('commit_strategy=vad');
      expect(url).not.toContain('secret-key');
      expect(headers).toEqual({ 'xi-api-key': 'secret-key' });
    },
    expectAudio: (sent) => expect(JSON.parse(String(sent))).toEqual({
      message_type: 'input_audio_chunk',
      audio_base_64: 'AQID',
    }),
    expectClose: () => undefined,
  },
];

describe.each(fixtures)('$name adapter contract', (fixture) => {
  it('normalizes partial, committed, and speech-boundary events', async () => {
    const fake = fakeSockets();
    const adapter = fixture.create(fake.factory);
    const events = adapter.events()[Symbol.asyncIterator]();
    const connecting = adapter.connect();
    fake.sockets[0]?.open();
    await connecting;

    fixture.expectConnection(fake.requests[0]!);
    fixture.emitTranscript(fake.sockets[0]!);

    expect(await nextEvent(events)).toEqual({ type: 'speech-start' });
    expect(await nextEvent(events)).toEqual({ type: 'partial', text: 'hello wor' });
    expect(await nextEvent(events)).toEqual({ type: 'final', text: 'hello world' });
    expect(await nextEvent(events)).toEqual({ type: 'speech-end' });
  });

  it('encodes audio without retaining the caller buffer', async () => {
    const fake = fakeSockets();
    const adapter = fixture.create(fake.factory);
    const connecting = adapter.connect();
    fake.sockets[0]?.open();
    await connecting;
    const audio = new Uint8Array([1, 2, 3]);

    adapter.sendAudio(audio);

    expect([...audio]).toEqual([0, 0, 0]);
    fixture.expectAudio(fake.sockets[0]!.sent[0]!);
  });

  it('fails closed on malformed provider events', async () => {
    const fake = fakeSockets();
    const adapter = fixture.create(fake.factory);
    const events = adapter.events()[Symbol.asyncIterator]();
    const connecting = adapter.connect();
    fake.sockets[0]?.open();
    await connecting;

    fake.sockets[0]?.message('{bad json');

    expect(await nextEvent(events)).toMatchObject({ type: 'error', code: 'invalid-event' });
    expect(await nextEvent(events)).toEqual({ type: 'closed' });
    expect(fake.sockets[0]?.closeCalls).toBe(1);
  });

  it.each(['authentication', 'quota'] as const)('normalizes %s errors', async (kind) => {
    const fake = fakeSockets();
    const adapter = fixture.create(fake.factory);
    const events = adapter.events()[Symbol.asyncIterator]();
    const connecting = adapter.connect();
    fake.sockets[0]?.open();
    await connecting;

    fixture.emitError(fake.sockets[0]!, kind);

    expect(await nextEvent(events)).toMatchObject({ type: 'error', code: kind });
    expect(await nextEvent(events)).toEqual({ type: 'closed' });
  });

  it('cancels a pending connection and zeros queued audio', async () => {
    const fake = fakeSockets();
    const adapter = fixture.create(fake.factory);
    const controller = new AbortController();
    const connecting = adapter.connect(controller.signal);
    const audio = new Uint8Array([4, 5, 6]);
    adapter.sendAudio(audio);

    controller.abort();

    await expect(connecting).rejects.toMatchObject({ name: 'AbortError' });
    expect([...audio]).toEqual([0, 0, 0]);
    expect(fake.sockets[0]?.sent).toEqual([]);
    expect(fake.sockets[0]?.closeCalls).toBe(1);
  });

  it('closes once and can reconnect with a fresh socket', async () => {
    const fake = fakeSockets();
    const adapter = fixture.create(fake.factory);
    const events = adapter.events()[Symbol.asyncIterator]();
    const firstConnect = adapter.connect();
    fake.sockets[0]?.open();
    await firstConnect;

    await adapter.close();
    await adapter.close();

    expect(await nextEvent(events)).toEqual({ type: 'closed' });
    expect(fake.sockets[0]?.closeCalls).toBe(1);
    fixture.expectClose(fake.sockets[0]!.sent);

    const reconnect = adapter.connect();
    fake.sockets[1]?.open();
    await reconnect;
    fixture.emitTranscript(fake.sockets[1]!);
    expect(await nextEvent(events)).toEqual({ type: 'speech-start' });
    expect(fake.requests).toHaveLength(2);
  });
});
