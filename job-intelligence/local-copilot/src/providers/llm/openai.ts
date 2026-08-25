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

const Delta = z.object({ type: z.literal('response.output_text.delta'), delta: z.string() }).passthrough();
const Tokens = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
}).passthrough();
const Refusal = z.object({
  type: z.enum(['response.refusal.delta', 'response.refusal.done']),
}).passthrough();
const Completed = z.object({
  type: z.literal('response.completed'),
  response: z.object({
    status: z.literal('completed'),
    output: z.array(z.object({
      content: z.array(z.object({ type: z.string() }).passthrough()).optional(),
    }).passthrough()).optional(),
    usage: Tokens,
  }).passthrough(),
}).passthrough();
const Incomplete = z.object({
  type: z.literal('response.incomplete'),
  response: z.object({
    status: z.literal('incomplete'),
    incomplete_details: z.object({ reason: z.literal('max_output_tokens') }).passthrough(),
    usage: Tokens,
  }).passthrough(),
}).passthrough();
const Failed = z.object({ type: z.enum(['response.failed', 'response.incomplete']) }).passthrough();
const Ignored = z.object({
  type: z.enum([
    'response.created', 'response.in_progress', 'response.queued',
    'response.output_item.added', 'response.output_item.done',
    'response.content_part.added', 'response.content_part.done',
    'response.output_text.done', 'response.refusal.done',
  ]),
}).passthrough();

export function createOpenAiAdapter(
  config: LlmProviderConfig,
  dependencies: LlmTransportDependencies = {},
): LlmAdapter {
  return createHttpLlmAdapter({
    config,
    endpoint: exactEndpoint('https://api.openai.com/v1/responses'),
    headers: { Authorization: `Bearer ${config.apiKey}` },
    buildBody: (request) => buildOpenAiBody(config.model, request),
    createMapper: createOpenAiMapper,
    fetch: dependencies.fetch,
  });
}

function buildOpenAiBody(model: string, request: CopilotRequest): unknown {
  const input = request.messages.map(({ role, content }) => ({
    role: role === 'system' ? 'developer' : role,
    content: [{ type: 'input_text', text: content }],
  }));
  const images = request.images?.map(({ mediaType, data }) => ({
    type: 'input_image', image_url: `data:${mediaType};base64,${data}`,
  })) ?? [];
  if (images.length) {
    const lastUser = [...input].reverse().find(({ role }) => role === 'user');
    if (lastUser) lastUser.content.push(...images as never[]);
    else input.push({ role: 'user', content: images as never[] });
  }
  return {
    model,
    input,
    stream: true,
    ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
  };
}

function createOpenAiMapper(): LlmStreamMapper {
  let completed = false;
  let refused = false;
  return {
    map(record) {
      let raw: unknown;
      try { raw = JSON.parse(record.data); } catch { return [invalidEvent()]; }
      if (record.event && record.event !== 'message'
        && (!raw || typeof raw !== 'object' || !('type' in raw) || raw.type !== record.event)) {
        return [invalidEvent()];
      }
      const delta = Delta.safeParse(raw);
      if (delta.success) return delta.data.delta ? [{ type: 'text-delta', text: delta.data.delta }] : [];
      const refusal = Refusal.safeParse(raw);
      if (refusal.success) {
        refused = true;
        return [];
      }
      const done = Completed.safeParse(raw);
      if (done.success) {
        completed = true;
        const tokens = done.data.response.usage;
        return [
          usage(tokens.input_tokens, tokens.output_tokens, tokens.total_tokens),
          {
            type: 'completed',
            reason: refused || hasRefusal(done.data.response.output) ? 'content-filter' : 'stop',
          },
        ];
      }
      const incomplete = Incomplete.safeParse(raw);
      if (incomplete.success) {
        completed = true;
        const tokens = incomplete.data.response.usage;
        return [
          usage(tokens.input_tokens, tokens.output_tokens, tokens.total_tokens),
          { type: 'completed', reason: 'length' },
        ];
      }
      if (Failed.safeParse(raw).success) {
        completed = true;
        return [failure('provider', 'The provider could not complete the response.')];
      }
      if (Ignored.safeParse(raw).success) return [];
      return [invalidEvent()];
    },
    end: () => completed ? [] : [invalidEvent()],
  };
}

function hasRefusal(output: z.infer<typeof Completed>['response']['output']): boolean {
  return output?.some((item) => item.content?.some(({ type }) => type === 'refusal')) ?? false;
}
