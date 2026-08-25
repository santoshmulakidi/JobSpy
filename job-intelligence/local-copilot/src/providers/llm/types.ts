import { z } from 'zod';

export type ModelCapability = 'text' | 'image';

export interface LlmProviderConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly capabilities: readonly ModelCapability[];
  readonly timeoutMs?: number;
}

export interface CopilotMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface CopilotImage {
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  readonly data: string;
}

export interface CopilotRequest {
  readonly messages: readonly CopilotMessage[];
  readonly images?: readonly CopilotImage[];
  readonly maxOutputTokens?: number;
}

export type LlmEvent =
  | { readonly type: 'request-accepted' }
  | { readonly type: 'text-delta'; readonly text: string }
  | {
      readonly type: 'usage';
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
    }
  | { readonly type: 'completed'; readonly reason: 'stop' | 'length' | 'content-filter' }
  | {
      readonly type: 'failed';
      readonly code:
        | 'authentication'
        | 'rate-limit'
        | 'timeout'
        | 'provider'
        | 'invalid-event'
        | 'unsupported-capability';
      readonly message: string;
      readonly retryable: boolean;
    };

export interface LlmAdapter {
  validate(config: LlmProviderConfig): Promise<ModelCapability[]>;
  stream(request: CopilotRequest, signal?: AbortSignal): AsyncIterable<LlmEvent>;
}

export interface LlmTransportDependencies {
  readonly fetch?: typeof globalThis.fetch;
}

export interface ProviderEndpoint {
  readonly url: string;
  allows(url: URL): boolean;
}

export interface SseRecord {
  readonly event?: string;
  readonly data: string;
}

export interface LlmStreamMapper {
  map(record: SseRecord): LlmEvent[];
  end(): LlmEvent[];
}

export interface HttpLlmAdapterOptions {
  readonly config: LlmProviderConfig;
  readonly endpoint: ProviderEndpoint;
  readonly headers: Readonly<Record<string, string>>;
  readonly buildBody: (request: CopilotRequest) => unknown;
  readonly createMapper: () => LlmStreamMapper;
  readonly validateConfig?: (config: LlmProviderConfig) => void;
  readonly fetch?: typeof globalThis.fetch;
}

const ConfigSchema = z.object({
  apiKey: z.string().trim().min(1),
  model: z.string().trim().min(1),
  capabilities: z.array(z.enum(['text', 'image'])).min(1),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
}).strict();

export function parseProviderConfig(config: LlmProviderConfig): LlmProviderConfig {
  const parsed = ConfigSchema.safeParse(config);
  if (!parsed.success) throw new Error('Invalid provider configuration.');
  return parsed.data;
}

export function createHttpLlmAdapter(options: HttpLlmAdapterOptions): LlmAdapter {
  const config = parseAndValidate(options.config, options.validateConfig);
  const fetchProvider = options.fetch ?? globalThis.fetch;

  return {
    async validate(candidate) {
      return [...parseAndValidate(candidate, options.validateConfig).capabilities];
    },
    async *stream(request, externalSignal) {
      if (request.images?.length && !config.capabilities.includes('image')) {
        yield failure('unsupported-capability', 'The selected model does not support images.');
        return;
      }
      if (externalSignal?.aborted) throw abortError();

      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort(abortError());
      externalSignal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException('The provider request timed out.', 'TimeoutError'));
      }, config.timeoutMs ?? 30_000);

      try {
        const response = await fetchProvider(options.endpoint.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...options.headers },
          body: JSON.stringify(options.buildBody(request)),
          signal: controller.signal,
          redirect: 'manual',
        });
        if (response.status >= 300 && response.status < 400) {
          yield failure('provider', 'Provider redirects are not allowed.');
          return;
        }
        if (response.url && !isAllowed(response.url, options.endpoint)) {
          yield failure('provider', 'Provider response violated the network policy.');
          return;
        }
        if (!response.ok) {
          yield classifyHttp(response.status);
          return;
        }
        if (!response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
          yield invalidEvent();
          return;
        }

        const mapper = options.createMapper();
        let accepted = false;
        for await (const record of parseSse(response.body, controller.signal)) {
          const mapped = mapper.map(record);
          const invalid = mapped.find((event) => event.type === 'failed' && event.code === 'invalid-event');
          if (invalid) {
            yield invalid;
            return;
          }
          if (!accepted) {
            accepted = true;
            yield { type: 'request-accepted' };
          }
          for (const event of mapped) {
            yield event;
            if (event.type === 'failed') return;
          }
        }
        const ending = mapper.end();
        if (!accepted && ending.some((event) => event.type !== 'failed')) {
          accepted = true;
          yield { type: 'request-accepted' };
        }
        for (const event of ending) yield event;
      } catch {
        if (externalSignal?.aborted) throw abortError();
        if (timedOut) {
          yield failure('timeout', 'The provider request timed out.', true);
          return;
        }
        yield failure('provider', 'The provider request failed.', true);
      } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

export function exactEndpoint(url: string): ProviderEndpoint {
  const expected = new URL(url);
  if (expected.protocol !== 'https:') throw new Error('Provider endpoints must use HTTPS.');
  return {
    url: expected.toString(),
    allows(candidate) {
      return candidate.protocol === 'https:'
        && candidate.hostname === expected.hostname
        && candidate.port === ''
        && candidate.username === ''
        && candidate.password === ''
        && candidate.pathname === expected.pathname
        && candidate.search === expected.search
        && candidate.hash === '';
    },
  };
}

export function failure(
  code: Extract<LlmEvent, { type: 'failed' }>['code'],
  message: string,
  retryable = false,
): Extract<LlmEvent, { type: 'failed' }> {
  return { type: 'failed', code, message, retryable };
}

export function invalidEvent(): Extract<LlmEvent, { type: 'failed' }> {
  return failure('invalid-event', 'Provider sent an invalid streaming event.');
}

export function usage(inputTokens: number, outputTokens: number, totalTokens = inputTokens + outputTokens): LlmEvent {
  return { type: 'usage', inputTokens, outputTokens, totalTokens };
}

function parseAndValidate(
  config: LlmProviderConfig,
  validate?: (config: LlmProviderConfig) => void,
): LlmProviderConfig {
  const parsed = parseProviderConfig(config);
  validate?.(parsed);
  return parsed;
}

function isAllowed(value: string, endpoint: ProviderEndpoint): boolean {
  try {
    return endpoint.allows(new URL(value));
  } catch {
    return false;
  }
}

function classifyHttp(status: number): Extract<LlmEvent, { type: 'failed' }> {
  if (status === 401 || status === 403) {
    return failure('authentication', 'Provider authentication failed.');
  }
  if (status === 429) return failure('rate-limit', 'Provider rate limit exceeded.', true);
  return failure('provider', 'The provider request failed.', status >= 500);
}

async function* parseSse(stream: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<SseRecord> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await readWithSignal(reader, signal);
      buffer += decoder.decode(value, { stream: !done });
      let boundary = findBoundary(buffer);
      while (boundary) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const record = parseSseBlock(block);
        if (record) yield record;
        boundary = findBoundary(buffer);
      }
      if (done) break;
    }
    if (buffer.trim()) throw new Error('Truncated SSE record.');
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function findBoundary(buffer: string): { index: number; length: number } | undefined {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : undefined;
}

function parseSseBlock(block: string): SseRecord | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : undefined;
}

function readWithSignal(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    void reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function abortError(): DOMException {
  return new DOMException('The provider request was cancelled.', 'AbortError');
}
