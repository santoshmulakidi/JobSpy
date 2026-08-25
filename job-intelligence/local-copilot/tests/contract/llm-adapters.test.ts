import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAnthropicAdapter } from '../../src/providers/llm/anthropic';
import { createGeminiAdapter } from '../../src/providers/llm/gemini';
import { createOpenAiAdapter } from '../../src/providers/llm/openai';
import { createOpenCodeAdapter, createOpenRouterAdapter } from '../../src/providers/llm/openrouter';
import {
  DEFAULT_LLM_PROVIDERS,
  createLlmAdapter,
  listLlmProviders,
} from '../../src/main/providers/provider-registry';
import type {
  CopilotRequest,
  LlmAdapter,
  LlmEvent,
  LlmProviderConfig,
} from '../../src/providers/llm/types';

const secret = 'super-secret-key';
const request: CopilotRequest = {
  messages: [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'Hello' },
  ],
  maxOutputTokens: 64,
};
const imageRequest: CopilotRequest = {
  messages: [{ role: 'user', content: 'Describe it' }],
  images: [{ mediaType: 'image/png', data: 'AQID' }],
};

function sse(records: readonly string[], splits: readonly number[] = []): Response {
  const encoded = new TextEncoder().encode(records.join(''));
  let offset = 0;
  let splitIndex = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === encoded.length) return controller.close();
      const length = splits[splitIndex++] ?? encoded.length - offset;
      controller.enqueue(encoded.slice(offset, offset += length));
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

function responseAt(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function http(status: number, statusText = ''): Response {
  return new Response('', { status, statusText });
}

async function collect(adapter: LlmAdapter, input = request, signal?: AbortSignal): Promise<LlmEvent[]> {
  const events: LlmEvent[] = [];
  for await (const event of adapter.stream(input, signal)) events.push(event);
  return events;
}

type FetchCall = { url: string; init: RequestInit };

function recordingFetch(response: Response | (() => Promise<Response>)) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return typeof response === 'function' ? response() : response;
  });
  return { fetch, calls };
}

interface Fixture {
  readonly name: string;
  readonly url: string;
  readonly model: string;
  create(config: LlmProviderConfig, fetch: typeof globalThis.fetch): LlmAdapter;
  stream(text?: string): Response;
  assertRequest(call: FetchCall): void;
}

const fixtures: Fixture[] = [
  {
    name: 'Gemini GenerateContent',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse',
    model: 'gemini-test',
    create: (config, fetch) => createGeminiAdapter(config, { fetch }),
    stream: (text = 'Hello') => sse([
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } })}\n\n`,
    ]),
    assertRequest: ({ url, init }) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse');
      expect(init.headers).toMatchObject({ 'x-goog-api-key': secret });
      expect(JSON.parse(String(init.body))).toMatchObject({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        systemInstruction: { parts: [{ text: 'Be concise.' }] },
        generationConfig: { maxOutputTokens: 64 },
      });
    },
  },
  {
    name: 'OpenAI Responses',
    url: 'https://api.openai.com/v1/responses',
    model: 'gpt-test',
    create: (config, fetch) => createOpenAiAdapter(config, { fetch }),
    stream: (text = 'Hello') => sse([
      'data: {"type":"response.created","response":{"id":"r1","status":"in_progress"}}\n\n',
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`,
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3}}}\n\n',
    ]),
    assertRequest: ({ url, init }) => {
      expect(url).toBe('https://api.openai.com/v1/responses');
      expect(init.headers).toMatchObject({ Authorization: `Bearer ${secret}` });
      expect(JSON.parse(String(init.body))).toMatchObject({ model: 'gpt-test', stream: true, max_output_tokens: 64 });
    },
  },
  {
    name: 'Anthropic Messages',
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-test',
    create: (config, fetch) => createAnthropicAdapter(config, { fetch }),
    stream: (text = 'Hello') => sse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":2,"output_tokens":0}}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`,
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]),
    assertRequest: ({ url, init }) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.headers).toMatchObject({ 'x-api-key': secret, 'anthropic-version': '2023-06-01' });
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: 'claude-test', stream: true, max_tokens: 64, system: 'Be concise.',
      });
    },
  },
  {
    name: 'OpenRouter chat completions',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'vendor/model:test',
    create: (config, fetch) => createOpenRouterAdapter(config, { fetch }),
    stream: (text = 'Hello') => sse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]),
    assertRequest: ({ url, init }) => {
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(init.headers).toMatchObject({ Authorization: `Bearer ${secret}` });
      expect(JSON.parse(String(init.body))).toMatchObject({ model: 'vendor/model:test', stream: true });
    },
  },
];

afterEach(() => vi.useRealTimers());

describe.each(fixtures)('$name adapter contract', (fixture) => {
  function setup(response = fixture.stream(), overrides: Partial<LlmProviderConfig> = {}) {
    const fake = recordingFetch(response);
    const config: LlmProviderConfig = {
      apiKey: secret,
      model: fixture.model,
      capabilities: ['text', 'image'],
      ...overrides,
    };
    return { ...fake, adapter: fixture.create(config, fake.fetch as typeof globalThis.fetch), config };
  }

  it('validates configuration locally and normalizes text, usage, and completion', async () => {
    const { adapter, calls, config } = setup();

    await expect(adapter.validate(config)).resolves.toEqual(['text', 'image']);
    expect(calls).toHaveLength(0);
    await expect(collect(adapter)).resolves.toEqual([
      { type: 'request-accepted' },
      { type: 'text-delta', text: 'Hello' },
      { type: 'usage', inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      { type: 'completed', reason: 'stop' },
    ]);
    fixture.assertRequest(calls[0]!);
    expect(calls[0]!.init).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(calls[0]!.url).not.toContain(secret);
  });

  it.each([[401, 'authentication'], [403, 'authentication'], [429, 'rate-limit']] as const)(
    'normalizes HTTP %s as %s without leaking provider text',
    async (status, code) => {
      const { adapter } = setup(http(status, `failed ${secret}`));
      const events = await collect(adapter);
      expect(events).toEqual([{ type: 'failed', code, message: expect.any(String), retryable: status === 429 }]);
      expect(JSON.stringify(events)).not.toContain(secret);
    },
  );

  it('fails closed on malformed or unknown streamed events', async () => {
    const { adapter } = setup(sse(['data: {bad json\n\n']));
    await expect(collect(adapter)).resolves.toEqual([{
      type: 'failed', code: 'invalid-event', message: 'Provider sent an invalid streaming event.', retryable: false,
    }]);
  });

  it('rejects images before networking when the configured model lacks image capability', async () => {
    const { adapter, calls } = setup(fixture.stream(), { capabilities: ['text'] });
    await expect(collect(adapter, imageRequest)).resolves.toEqual([{
      type: 'failed', code: 'unsupported-capability', message: 'The selected model does not support images.', retryable: false,
    }]);
    expect(calls).toHaveLength(0);
  });
});

describe('HTTP streaming boundary', () => {
  it('parses CRLF, comments, and data split across arbitrary byte boundaries', async () => {
    const payload = [
      ': keepalive\r\n\r\n',
      'data: {"type":"response.created","response":{"id":"r1","status":"in_progress"}}\r\n\r\n',
      'data: {"type":"response.output_text.delta",\r\n',
      'data: "delta":"split"}\r\n\r\n',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":0,"output_tokens":1,"total_tokens":1}}}\r\n\r\n',
    ];
    const fake = recordingFetch(sse(payload, [1, 2, 5, 3, 7, 11, 13]));
    const adapter = createOpenAiAdapter(
      { apiKey: secret, model: 'gpt-test', capabilities: ['text'] },
      { fetch: fake.fetch as typeof globalThis.fetch },
    );

    expect(await collect(adapter)).toContainEqual({ type: 'text-delta', text: 'split' });
  });

  it('rejects redirects and off-allowlist final response URLs', async () => {
    const redirected = recordingFetch(http(302));
    const redirectedAdapter = createOpenAiAdapter(
      { apiKey: secret, model: 'gpt-test', capabilities: ['text'] },
      { fetch: redirected.fetch as typeof globalThis.fetch },
    );
    expect(await collect(redirectedAdapter)).toEqual([{
      type: 'failed', code: 'provider', message: 'Provider redirects are not allowed.', retryable: false,
    }]);

    const escaped = recordingFetch(responseAt(fixtures[1]!.stream(), 'https://evil.example/v1/responses'));
    const escapedAdapter = createOpenAiAdapter(
      { apiKey: secret, model: 'gpt-test', capabilities: ['text'] },
      { fetch: escaped.fetch as typeof globalThis.fetch },
    );
    expect(await collect(escapedAdapter)).toEqual([{
      type: 'failed', code: 'provider', message: 'Provider response violated the network policy.', retryable: false,
    }]);
  });

  it('supports caller cancellation and bounded timeouts', async () => {
    const pending = () => new Promise<Response>((_resolve, reject) => {
      const signal = timeoutFetch.calls.at(-1)?.init.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    const timeoutFetch = recordingFetch(pending);
    const timed = createOpenAiAdapter(
      { apiKey: secret, model: 'gpt-test', capabilities: ['text'], timeoutMs: 10 },
      { fetch: timeoutFetch.fetch as typeof globalThis.fetch },
    );
    vi.useFakeTimers();
    const timedEvents = collect(timed);
    await vi.advanceTimersByTimeAsync(10);
    await expect(timedEvents).resolves.toEqual([{
      type: 'failed', code: 'timeout', message: 'The provider request timed out.', retryable: true,
    }]);
    vi.useRealTimers();

    const cancelledFetch = recordingFetch(() => new Promise<Response>((_resolve, reject) => {
      const signal = cancelledFetch.calls.at(-1)?.init.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const cancelled = createOpenAiAdapter(
      { apiKey: secret, model: 'gpt-test', capabilities: ['text'] },
      { fetch: cancelledFetch.fetch as typeof globalThis.fetch },
    );
    const controller = new AbortController();
    const cancelledEvents = collect(cancelled, request, controller.signal);
    controller.abort();
    await expect(cancelledEvents).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('provider-specific request mapping', () => {
  it.each(fixtures)('$name maps approved images', async (fixture) => {
    const fake = recordingFetch(fixture.stream());
    const adapter = fixture.create(
      { apiKey: secret, model: fixture.model, capabilities: ['text', 'image'] },
      fake.fetch as typeof globalThis.fetch,
    );

    await collect(adapter, imageRequest);

    const body = String(fake.calls[0]!.init.body);
    expect(body).toContain('AQID');
    expect(body).toContain('image/png');
  });
});

describe('provider-specific response mapping', () => {
  it('accepts named OpenAI Responses events when the event name matches the payload type', async () => {
    const fake = recordingFetch(sse([
      'event: response.created\ndata: {"type":"response.created","response":{"id":"r1","status":"in_progress"}}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3}}}\n\n',
    ]));
    const adapter = createOpenAiAdapter(
      { apiKey: secret, model: 'gpt-test', capabilities: ['text'] },
      { fetch: fake.fetch as typeof globalThis.fetch },
    );

    expect(await collect(adapter)).toEqual([
      { type: 'request-accepted' },
      { type: 'text-delta', text: 'Hello' },
      { type: 'usage', inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      { type: 'completed', reason: 'stop' },
    ]);
  });

  it.each([
    ['mismatched', 'response.output_text.delta', 'response.created'],
    ['unknown', 'response.future', 'response.future'],
  ])('rejects %s named OpenAI Responses events safely', async (_case, event, type) => {
    const fake = recordingFetch(sse([`event: ${event}\ndata: ${JSON.stringify({ type })}\n\n`]));
    const adapter = createOpenAiAdapter(
      { apiKey: secret, model: 'gpt-test', capabilities: ['text'] },
      { fetch: fake.fetch as typeof globalThis.fetch },
    );

    expect(await collect(adapter)).toEqual([{
      type: 'failed', code: 'invalid-event', message: 'Provider sent an invalid streaming event.', retryable: false,
    }]);
  });

  it.each([
    ['OpenRouter', createOpenRouterAdapter, 'vendor/model'],
    ['OpenCode', createOpenCodeAdapter, 'ox-alpha'],
  ] as const)('%s accepts a final usage-only chat chunk', async (_name, create, model) => {
    const fake = recordingFetch(sse([
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = create(
      { apiKey: secret, model, capabilities: ['text'] },
      { fetch: fake.fetch as typeof globalThis.fetch },
    );

    expect(await collect(adapter)).toEqual([
      { type: 'request-accepted' },
      { type: 'text-delta', text: 'Hello' },
      { type: 'usage', inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      { type: 'completed', reason: 'stop' },
    ]);
  });

  it('maps OpenAI max-output-token incompletion to length and preserves usage', async () => {
    const fake = recordingFetch(sse([
      'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":2,"output_tokens":4,"total_tokens":6}}}\n\n',
    ]));
    const adapter = createOpenAiAdapter(
      { apiKey: secret, model: 'gpt-test', capabilities: ['text'] },
      { fetch: fake.fetch as typeof globalThis.fetch },
    );

    expect(await collect(adapter)).toEqual([
      { type: 'request-accepted' },
      { type: 'usage', inputTokens: 2, outputTokens: 4, totalTokens: 6 },
      { type: 'completed', reason: 'length' },
    ]);
  });

  it.each([
    ['refusal delta', [
      'event: response.refusal.delta\ndata: {"type":"response.refusal.delta","delta":"I cannot help with that."}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":2,"output_tokens":5,"total_tokens":7}}}\n\n',
    ]],
    ['refusal output', [
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"refusal","refusal":"I cannot help with that."}]}],"usage":{"input_tokens":2,"output_tokens":5,"total_tokens":7}}}\n\n',
    ]],
  ] as const)('maps OpenAI %s to content-filter without emitting refusal text', async (_case, records) => {
    const fake = recordingFetch(sse(records));
    const adapter = createOpenAiAdapter(
      { apiKey: secret, model: 'gpt-test', capabilities: ['text'] },
      { fetch: fake.fetch as typeof globalThis.fetch },
    );

    expect(await collect(adapter)).toEqual([
      { type: 'request-accepted' },
      { type: 'usage', inputTokens: 2, outputTokens: 5, totalTokens: 7 },
      { type: 'completed', reason: 'content-filter' },
    ]);
  });

  it('maps Gemini prompt-level blocking without candidates to content-filter', async () => {
    const fake = recordingFetch(sse([
      'data: {"promptFeedback":{"blockReason":"SAFETY","safetyRatings":[]}}\n\n',
    ]));
    const adapter = createGeminiAdapter(
      { apiKey: secret, model: 'gemini-test', capabilities: ['text'] },
      { fetch: fake.fetch as typeof globalThis.fetch },
    );

    expect(await collect(adapter)).toEqual([
      { type: 'request-accepted' },
      { type: 'completed', reason: 'content-filter' },
    ]);
  });
});

describe('completion validation', () => {
  it('rejects a truncated stream and an unknown finish reason', async () => {
    const truncated = recordingFetch(sse([
      'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
    ]));
    const openai = createOpenAiAdapter(
      { apiKey: secret, model: 'gpt-test', capabilities: ['text'] },
      { fetch: truncated.fetch as typeof globalThis.fetch },
    );
    expect((await collect(openai)).at(-1)).toMatchObject({ type: 'failed', code: 'invalid-event' });

    const unknown = recordingFetch(sse([
      'data: {"choices":[{"delta":{},"finish_reason":"mystery"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const openrouter = createOpenRouterAdapter(
      { apiKey: secret, model: 'vendor/model', capabilities: ['text'] },
      { fetch: unknown.fetch as typeof globalThis.fetch },
    );
    expect(await collect(openrouter)).toEqual([{
      type: 'failed', code: 'invalid-event', message: 'Provider sent an invalid streaming event.', retryable: false,
    }]);
  });
});

describe('provider registry and OpenCode opt-in', () => {
  it('keeps OpenCode optional and discloses its external destination', () => {
    expect(DEFAULT_LLM_PROVIDERS).toEqual(['gemini', 'openai', 'anthropic', 'openrouter']);
    expect(listLlmProviders()).not.toContainEqual(expect.objectContaining({ id: 'opencode' }));
    expect(listLlmProviders({ includeOptional: true })).toContainEqual(expect.objectContaining({
      id: 'opencode', optional: true, destination: 'OpenCode (requests leave this device)', tools: false,
    }));
  });

  it.each(['ox-alpha', 'ox-alpha-free'] as const)('preserves supported OpenCode model %s', async (model) => {
    const fake = recordingFetch(sse([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createOpenCodeAdapter(
      { apiKey: secret, model, capabilities: ['text', 'image'] },
      { fetch: fake.fetch as typeof globalThis.fetch },
    );

    await collect(adapter);

    expect(fake.calls[0]!.url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(JSON.parse(String(fake.calls[0]!.init.body)).model).toBe(model);
  });

  it('rejects unlisted OpenCode models without networking', async () => {
    const fake = recordingFetch(fixtures[3]!.stream());
    expect(() => createLlmAdapter(
      'opencode',
      { apiKey: secret, model: 'other-model', capabilities: ['text'] },
      { fetch: fake.fetch as typeof globalThis.fetch },
    )).toThrow('OpenCode model must be ox-alpha or ox-alpha-free.');
    expect(fake.calls).toHaveLength(0);
  });
});
