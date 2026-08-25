import { z } from 'zod';

import {
  createHttpLlmAdapter,
  encodeImageData,
  exactEndpoint,
  invalidEvent,
  usage,
  type CopilotRequest,
  type LlmAdapter,
  type LlmEvent,
  type LlmProviderConfig,
  type LlmStreamMapper,
  type LlmTransportDependencies,
} from './types';

const MessageStart = z.object({
  type: z.literal('message_start'),
  message: z.object({ usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }).passthrough() }).passthrough(),
}).passthrough();
const TextDelta = z.object({
  type: z.literal('content_block_delta'),
  index: z.number().int().nonnegative(),
  delta: z.object({ type: z.literal('text_delta'), text: z.string() }).passthrough(),
}).passthrough();
const MessageDelta = z.object({
  type: z.literal('message_delta'),
  delta: z.object({ stop_reason: z.enum(['end_turn', 'stop_sequence', 'max_tokens', 'refusal']) }).passthrough(),
  usage: z.object({ output_tokens: z.number().int().nonnegative() }).passthrough(),
}).passthrough();
const MessageStop = z.object({ type: z.literal('message_stop') }).passthrough();
const Ignored = z.object({
  type: z.enum(['ping', 'content_block_start', 'content_block_stop']),
}).passthrough();

export function createAnthropicAdapter(
  config: LlmProviderConfig,
  dependencies: LlmTransportDependencies = {},
): LlmAdapter {
  return createHttpLlmAdapter({
    config,
    endpoint: exactEndpoint('https://api.anthropic.com/v1/messages'),
    headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
    buildBody: (request) => buildAnthropicBody(config.model, request),
    createMapper: createAnthropicMapper,
    fetch: dependencies.fetch,
  });
}

function buildAnthropicBody(model: string, request: CopilotRequest): unknown {
  const system = request.messages.filter(({ role }) => role === 'system').map(({ content }) => content).join('\n');
  const messages = request.messages
    .filter(({ role }) => role !== 'system')
    .map(({ role, content }) => ({ role, content: [{ type: 'text', text: content }] }));
  const images = request.images?.map(({ mediaType, data }) => ({
    type: 'image', source: { type: 'base64', media_type: mediaType, data: encodeImageData(data) },
  })) ?? [];
  if (images.length) {
    const lastUser = [...messages].reverse().find(({ role }) => role === 'user');
    if (lastUser) lastUser.content.push(...images as never[]);
    else messages.push({ role: 'user', content: images as never[] });
  }
  return {
    model,
    messages,
    stream: true,
    max_tokens: request.maxOutputTokens ?? 1_024,
    ...(system ? { system } : {}),
  };
}

function createAnthropicMapper(): LlmStreamMapper {
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: Extract<LlmEvent, { type: 'completed' }>['reason'] | undefined;
  let completed = false;
  return {
    map(record) {
      let raw: unknown;
      try { raw = JSON.parse(record.data); } catch { return [invalidEvent()]; }
      if (record.event && (raw as { type?: unknown }).type !== record.event) return [invalidEvent()];
      const start = MessageStart.safeParse(raw);
      if (start.success) {
        inputTokens = start.data.message.usage.input_tokens;
        outputTokens = start.data.message.usage.output_tokens;
        return [];
      }
      const delta = TextDelta.safeParse(raw);
      if (delta.success) return delta.data.delta.text ? [{ type: 'text-delta', text: delta.data.delta.text }] : [];
      const messageDelta = MessageDelta.safeParse(raw);
      if (messageDelta.success) {
        outputTokens = messageDelta.data.usage.output_tokens;
        stopReason = anthropicReason(messageDelta.data.delta.stop_reason);
        return [];
      }
      if (MessageStop.safeParse(raw).success) {
        if (!stopReason) return [invalidEvent()];
        completed = true;
        return [usage(inputTokens, outputTokens), { type: 'completed', reason: stopReason }];
      }
      if (Ignored.safeParse(raw).success) return [];
      return [invalidEvent()];
    },
    end: () => completed ? [] : [invalidEvent()],
  };
}

function anthropicReason(reason: z.infer<typeof MessageDelta>['delta']['stop_reason']): Extract<LlmEvent, { type: 'completed' }>['reason'] {
  if (reason === 'max_tokens') return 'length';
  if (reason === 'refusal') return 'content-filter';
  return 'stop';
}
