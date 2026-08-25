import { z } from 'zod';

import {
  createHttpLlmAdapter,
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

const Chunk = z.object({
  promptFeedback: z.object({ blockReason: z.string().min(1) }).passthrough().optional(),
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional() }).passthrough()),
    }).passthrough().optional(),
    finishReason: z.string().optional(),
  }).passthrough()).optional(),
  usageMetadata: z.object({
    promptTokenCount: z.number().int().nonnegative(),
    candidatesTokenCount: z.number().int().nonnegative(),
    totalTokenCount: z.number().int().nonnegative(),
  }).passthrough().optional(),
}).passthrough().refine((value) => value.promptFeedback || value.candidates || value.usageMetadata);

export function createGeminiAdapter(
  config: LlmProviderConfig,
  dependencies: LlmTransportDependencies = {},
): LlmAdapter {
  const model = encodeURIComponent(config.model);
  return createHttpLlmAdapter({
    config,
    endpoint: exactEndpoint(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`),
    headers: { 'x-goog-api-key': config.apiKey },
    buildBody: buildGeminiBody,
    createMapper: createGeminiMapper,
    fetch: dependencies.fetch,
  });
}

function buildGeminiBody(request: CopilotRequest): unknown {
  const system = request.messages.filter(({ role }) => role === 'system').map(({ content }) => content).join('\n');
  const contents = request.messages
    .filter(({ role }) => role !== 'system')
    .map(({ role, content }) => ({ role: role === 'assistant' ? 'model' : 'user', parts: [{ text: content }] }));
  const images = request.images?.map(({ mediaType, data }) => ({ inlineData: { mimeType: mediaType, data } })) ?? [];
  if (images.length) {
    const lastUser = [...contents].reverse().find(({ role }) => role === 'user');
    if (lastUser) lastUser.parts.push(...images as never[]);
    else contents.push({ role: 'user', parts: images as never[] });
  }
  return {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(request.maxOutputTokens ? { generationConfig: { maxOutputTokens: request.maxOutputTokens } } : {}),
  };
}

function createGeminiMapper(): LlmStreamMapper {
  let completed = false;
  return {
    map(record) {
      if (record.event && record.event !== 'message') return [invalidEvent()];
      let raw: unknown;
      try { raw = JSON.parse(record.data); } catch { return [invalidEvent()]; }
      const parsed = Chunk.safeParse(raw);
      if (!parsed.success) return [invalidEvent()];
      const events: LlmEvent[] = [];
      for (const candidate of parsed.data.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.text) events.push({ type: 'text-delta', text: part.text });
        }
      }
      const tokens = parsed.data.usageMetadata;
      if (tokens) events.push(usage(tokens.promptTokenCount, tokens.candidatesTokenCount, tokens.totalTokenCount));
      if (parsed.data.promptFeedback?.blockReason) {
        completed = true;
        events.push({ type: 'completed', reason: 'content-filter' });
        return events;
      }
      const finishReason = parsed.data.candidates?.find(({ finishReason }) => finishReason)?.finishReason;
      if (finishReason) {
        const reason = geminiReason(finishReason);
        if (!reason) return [invalidEvent()];
        completed = true;
        events.push({ type: 'completed', reason });
      }
      return events;
    },
    end: () => completed ? [] : [invalidEvent()],
  };
}

function geminiReason(reason: string): Extract<LlmEvent, { type: 'completed' }>['reason'] | undefined {
  if (reason === 'STOP') return 'stop';
  if (reason === 'MAX_TOKENS') return 'length';
  if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(reason)) {
    return 'content-filter';
  }
  return undefined;
}
