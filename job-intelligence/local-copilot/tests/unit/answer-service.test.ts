import { describe, expect, it, vi } from 'vitest';

import { AnswerService, type AnswerEvent, type AnswerSecretStore } from '../../src/main/answers/answer-service';
import type { ScreenshotAttachment } from '../../src/main/capture/screenshot-service';
import type { CopilotRequest, LlmAdapter, LlmEvent } from '../../src/providers/llm/types';

const providers = [
  { id: 'openai' as const },
  { id: 'opencode' as const, models: ['ox-alpha', 'ox-alpha-free'] as const },
];

const isConfigured = vi.fn((providerId: string) => providerId === 'openai');
const secretStore: AnswerSecretStore = {
  isConfigured: (providerId) => isConfigured(providerId),
  withSecret: (_providerId, useSecret) => useSecret('sk-test-key'),
};

function scriptedAdapter(events: readonly LlmEvent[]): LlmAdapter & { requests: CopilotRequest[] } {
  const requests: CopilotRequest[] = [];
  return {
    requests,
    async validate() {
      return ['text', 'image'];
    },
    async *stream(request, signal) {
      requests.push(structuredCopyRequest(request));
      if (signal?.aborted) throw abortError();
      for (const event of events) {
        if (signal?.aborted) throw abortError();
        await Promise.resolve();
        yield event;
      }
    },
  };
}

function hangingAdapter(): LlmAdapter {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  void release;
  return {
    async validate() {
      return ['text'];
    },
    async *stream(_request, signal) {
      await Promise.race([
        gate,
        new Promise<never>((_, reject) => {
          signal?.addEventListener('abort', () => reject(abortError()), { once: true });
        }),
      ]);
      yield { type: 'completed', reason: 'stop' };
    },
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createServiceWithAdapter(...adapters: LlmAdapter[]) {
  const events: AnswerEvent[] = [];
  let index = 0;
  const service = new AnswerService({
    providers,
    secretStore,
    publish: (event) => events.push(event),
    createAdapter: () => adapters[index++]!,
  });
  return { service, events };
}

const attachments: ScreenshotAttachment[] = [
  { id: 'shot-1', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) },
];

describe('AnswerService', () => {
  it('rejects unknown providers, missing keys, and empty questions without streaming', async () => {
    const adapter = scriptedAdapter([{ type: 'completed', reason: 'stop' }]);
    const { service, events } = createServiceWithAdapter(adapter);

    expect(service.send({ providerId: 'gemini', question: 'Hello?' })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(service.send({ providerId: 'openai', question: '   ' })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(service.send({ providerId: 'opencode', question: 'Hello?' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    await settle();

    expect(adapter.requests).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('streams deltas and completes with the resolved model', async () => {
    const adapter = scriptedAdapter([
      { type: 'request-accepted' },
      { type: 'text-delta', text: '**Safe** ' },
      { type: 'text-delta', text: 'answer' },
      { type: 'completed', reason: 'stop' },
      { type: 'usage', inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    ]);
    const { service, events } = createServiceWithAdapter(adapter);

    expect(service.send({ providerId: 'openai', question: 'Is this offer safe?' })).toEqual({ ok: true });
    await settle();

    expect(events.map(({ type }) => type)).toEqual(['answer-delta', 'answer-delta', 'answer-completed']);
    expect(events.at(-1)).toMatchObject({ type: 'answer-completed', model: 'gpt-4o-mini' });
    expect(JSON.stringify(events)).not.toContain('sk-test-key');
  });

  it('honors a requested model when the provider lists alternatives', async () => {
    isConfigured.mockImplementation((providerId: string) => providerId === 'openai' || providerId === 'opencode');
    try {
      const adapter = scriptedAdapter([{ type: 'completed', reason: 'stop' }]);
      const { service } = createServiceWithAdapter(adapter);

      expect(service.send({ providerId: 'opencode', model: 'ox-alpha-free', question: 'Ready?' })).toEqual({ ok: true });
      await settle();

      expect(adapter.requests[0]?.messages.at(-1)?.content).toContain('CURRENT QUESTION');
    } finally {
      isConfigured.mockImplementation((providerId: string) => providerId === 'openai');
    }
  });

  it('passes approved screenshots as images without leaking their bytes into events', async () => {
    const adapter = scriptedAdapter([
      { type: 'text-delta', text: 'Looks standard.' },
      { type: 'completed', reason: 'stop' },
    ]);
    const { service, events } = createServiceWithAdapter(adapter);

    expect(service.send({ providerId: 'openai', question: 'Any red flags?', attachments })).toEqual({ ok: true });
    await settle();

    const request = adapter.requests[0]!;
    expect(request.messages.filter(({ role }) => role === 'system')).toHaveLength(1);
    expect(JSON.stringify(request.messages)).toContain('shot-1');
    expect(request.images).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('"0":1');
  });

  it('reports provider failures as events and allows an immediate retry', async () => {
    const { service, events } = createServiceWithAdapter(
      scriptedAdapter([{ type: 'failed', code: 'timeout', message: 'The provider request timed out.', retryable: true }]),
      scriptedAdapter([{ type: 'text-delta', text: 'Recovered.' }, { type: 'completed', reason: 'stop' }]),
    );

    expect(service.send({ providerId: 'openai', question: 'First attempt?' })).toEqual({ ok: true });
    await settle();
    expect(events.at(-1)).toMatchObject({ type: 'answer-failed', message: 'The provider request timed out.' });

    expect(service.send({ providerId: 'openai', question: 'Second attempt?' })).toEqual({ ok: true });
    await settle();
    expect(events.at(-1)).toMatchObject({ type: 'answer-completed' });
    expect(events.some((event) => event.type === 'answer-delta' && event.text === 'Recovered.')).toBe(true);
  });

  it('rejects concurrent sends, then cancels the in-flight request and clears pending state', async () => {
    const { service, events } = createServiceWithAdapter(hangingAdapter());

    expect(service.send({ providerId: 'openai', question: 'Long running?' })).toEqual({ ok: true });
    expect(service.send({ providerId: 'openai', question: 'While busy?' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });

    service.cancel();
    await settle();

    expect(events).toEqual([{ type: 'answer-cancelled' }]);
    expect(service.send({ providerId: 'openai', question: 'After cancel?' })).toEqual({ ok: true });
  });

  it('carries ephemeral history into follow-up requests and bounds its size', async () => {
    const first = scriptedAdapter([{ type: 'text-delta', text: 'First answer.' }, { type: 'completed', reason: 'stop' }]);
    const second = scriptedAdapter([{ type: 'text-delta', text: 'Second answer.' }, { type: 'completed', reason: 'stop' }]);
    let index = 0;
    const service = new AnswerService({
      providers,
      secretStore,
      publish: () => undefined,
      createAdapter: () => [first, second][index++]!,
      historyLimit: 2,
    });

    expect(service.send({ providerId: 'openai', question: 'Question one?' })).toEqual({ ok: true });
    await settle();
    expect(second.requests).toHaveLength(0);

    expect(service.send({ providerId: 'openai', question: 'Question two?' })).toEqual({ ok: true });
    await settle();

    const quoted = second.requests[0]!.messages.filter(({ content }) => content.startsWith('UNTRUSTED_DATA'));
    expect(quoted).toHaveLength(2);
    expect(quoted.some(({ content }) => content.includes('Question one?'))).toBe(true);
    expect(second.requests[0]!.messages.at(-1)?.content).toContain('Question two?');
  });

  it('cancels in-flight work on dispose', async () => {
    const { service, events } = createServiceWithAdapter(hangingAdapter());

    expect(service.send({ providerId: 'openai', question: 'Before dispose?' })).toEqual({ ok: true });
    service.dispose();
    await settle();

    expect(events).toEqual([{ type: 'answer-cancelled' }]);
  });
});

function structuredCopyRequest(request: CopilotRequest): CopilotRequest {
  return {
    messages: [...request.messages],
    ...(request.images ? { images: [...request.images] } : {}),
    ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
  };
}

function abortError(): DOMException {
  return new DOMException('The provider request was cancelled.', 'AbortError');
}
