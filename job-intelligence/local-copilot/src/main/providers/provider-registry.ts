import { createAnthropicAdapter } from '../../providers/llm/anthropic';
import { createGeminiAdapter } from '../../providers/llm/gemini';
import { createOpenAiAdapter } from '../../providers/llm/openai';
import { createOpenCodeAdapter, createOpenRouterAdapter } from '../../providers/llm/openrouter';
import type {
  LlmAdapter,
  LlmProviderConfig,
  LlmTransportDependencies,
} from '../../providers/llm/types';
import { createDeepgramAdapter } from '../../providers/stt/deepgram';
import { createElevenLabsAdapter } from '../../providers/stt/elevenlabs';
import type { TranscriptionAdapter, WebSocketFactory } from '../../providers/stt/types';

export type LlmProviderId = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'opencode';

export const DEFAULT_LLM_PROVIDERS = ['gemini', 'openai', 'anthropic', 'openrouter'] as const;

const PROVIDERS = [
  { id: 'gemini', optional: false, destination: 'Google Gemini (requests leave this device)', tools: false },
  { id: 'openai', optional: false, destination: 'OpenAI (requests leave this device)', tools: false },
  { id: 'anthropic', optional: false, destination: 'Anthropic (requests leave this device)', tools: false },
  { id: 'openrouter', optional: false, destination: 'OpenRouter (requests leave this device)', tools: false },
  { id: 'opencode', optional: true, destination: 'OpenCode (requests leave this device)', tools: false },
] as const;

export function listLlmProviders(options: { readonly includeOptional?: boolean } = {}) {
  return PROVIDERS.filter(({ optional }) => !optional || options.includeOptional);
}

export function createLlmAdapter(
  provider: LlmProviderId,
  config: LlmProviderConfig,
  dependencies: LlmTransportDependencies = {},
): LlmAdapter {
  switch (provider) {
    case 'gemini': return createGeminiAdapter(config, dependencies);
    case 'openai': return createOpenAiAdapter(config, dependencies);
    case 'anthropic': return createAnthropicAdapter(config, dependencies);
    case 'openrouter': return createOpenRouterAdapter(config, dependencies);
    case 'opencode': return createOpenCodeAdapter(config, dependencies);
  }
}

export type SttProviderId = 'deepgram' | 'elevenlabs';

export function createSttAdapter(
  provider: SttProviderId,
  options: { readonly apiKey: string; readonly webSocketFactory: WebSocketFactory },
): TranscriptionAdapter {
  switch (provider) {
    case 'deepgram': return createDeepgramAdapter({ apiKey: options.apiKey, webSocketFactory: options.webSocketFactory });
    case 'elevenlabs': return createElevenLabsAdapter({ apiKey: options.apiKey, webSocketFactory: options.webSocketFactory });
  }
}
