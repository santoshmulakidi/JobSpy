import { z } from 'zod';

import {
  createHttpLlmAdapter,
  exactEndpoint,
  failure,
  invalidEvent,
  usage,
  type CopilotRequest,
  type LlmAdapter,
  type LlmEvent,
  type LlmProviderConfig,
  type LlmStreamMapper,
  type LlmTransportDependencies,
} from './types';

const ChatChunk = z.object({
  choices: z.array(z.object({
    delta: z.object({ content: z.string().nullable().optional() }).passthrough(),
    finish_reason: z.enum(['stop', 'length', 'content_filter']).nullable(),
  }).passthrough()),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }).passthrough().optional(),
}).passthrough().refine(({ choices, usage }) => choices.length > 0 || usage);
const ChatError = z.object({ error: z.object({ code: z.union([z.string(), z.number()]).optional() }).passthrough() }).passthrough();

export function createOpenRouterAdapter(
  config: LlmProviderConfig,
  dependencies: LlmTransportDependencies = {},
): LlmAdapter {
  return createChatAdapter(
    config,
    exactEndpoint('https://openrouter.ai/api/v1/chat/completions'),
    dependencies,
  );
}

export function createOpenCodeAdapter(
  config: LlmProviderConfig,
  dependencies: LlmTransportDependencies = {},
): LlmAdapter {
  return createChatAdapter(
    config,
    exactEndpoint('https://opencode.ai/zen/go/v1/chat/completions'),
    dependencies,
    validateOpenCode,
  );
}

function createChatAdapter(
  config: LlmProviderConfig,
  endpoint: ReturnType<typeof exactEndpoint>,
  dependencies: LlmTransportDependencies,
  validateConfig?: (config: LlmProviderConfig) => void,
): LlmAdapter {
  return createHttpLlmAdapter({
    config,
    endpoint,
    headers: { Authorization: `Bearer ${config.apiKey}` },
    buildBody: (request) => buildChatBody(config.model, request),
    createMapper: createChatMapper,
    validateConfig,
    fetch: dependencies.fetch,
  });
}

function buildChatBody(model: string, request: CopilotRequest): unknown {
  const messages = request.messages.map(({ role, content }) => ({ role, content }));
  const images = request.images?.map(({ mediaType, data }) => ({
    type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` },
  })) ?? [];
  if (images.length) {
    const lastUser = [...messages].reverse().find(({ role }) => role === 'user');
    if (lastUser) {
      lastUser.content = [{ type: 'text', text: lastUser.content }, ...images] as never;
    } else {
      messages.push({ role: 'user', content: images as never });
    }
  }
  return {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
  };
}

function createChatMapper(): LlmStreamMapper {
  let completed = false;
  let completionReason: Extract<LlmEvent, { type: 'completed' }>['reason'] | undefined;
  return {
    map(record) {
      if (record.event && record.event !== 'message') return [invalidEvent()];
      if (record.data === '[DONE]') {
        if (completed) return [];
        if (!completionReason) return [invalidEvent()];
        completed = true;
        return [{ type: 'completed', reason: completionReason }];
      }
      let raw: unknown;
      try { raw = JSON.parse(record.data); } catch { return [invalidEvent()]; }
      const providerFailure = ChatError.safeParse(raw);
      if (providerFailure.success) {
        completed = true;
        return [failure('provider', 'The provider could not complete the response.')];
      }
      const parsed = ChatChunk.safeParse(raw);
      if (!parsed.success) return [invalidEvent()];
      const events: LlmEvent[] = [];
      const choice = parsed.data.choices[0];
      if (choice?.delta.content) events.push({ type: 'text-delta', text: choice.delta.content });
      const tokens = parsed.data.usage;
      if (tokens) events.push(usage(tokens.prompt_tokens, tokens.completion_tokens, tokens.total_tokens));
      if (choice?.finish_reason) completionReason = chatReason(choice.finish_reason);
      return events;
    },
    end: () => {
      if (completed) return [];
      if (!completionReason) return [invalidEvent()];
      completed = true;
      return [{ type: 'completed', reason: completionReason }];
    },
  };
}

function chatReason(reason: 'stop' | 'length' | 'content_filter'): Extract<LlmEvent, { type: 'completed' }>['reason'] {
  if (reason === 'length') return 'length';
  if (reason === 'content_filter') return 'content-filter';
  return 'stop';
}

function validateOpenCode(config: LlmProviderConfig): void {
  if (!['ox-alpha', 'ox-alpha-free'].includes(config.model)) {
    throw new Error('OpenCode model must be ox-alpha or ox-alpha-free.');
  }
}
