import { randomUUID } from 'node:crypto';

import { buildCopilotRequest, type ContextHistoryMessage } from '../../context/context-engine';
import type { ScreenshotAttachment } from '../capture/screenshot-service';
import { createLlmAdapter, type LlmProviderId } from '../providers/provider-registry';
import type { LlmAdapter, LlmProviderConfig } from '../../providers/llm/types';

export type AnswerEvent = {
  readonly type: 'answer-delta';
  readonly text: string;
} | {
  readonly type: 'answer-completed';
  readonly model: string;
  readonly latencyMs: number;
} | {
  readonly type: 'answer-failed';
  readonly message: string;
} | {
  readonly type: 'answer-cancelled';
}

export interface AnswerRequest {
  readonly providerId: LlmProviderId;
  readonly model?: string;
  readonly question: string;
  readonly attachments?: readonly ScreenshotAttachment[];
}

export type AnswerSettlement = {
  readonly outcome: 'completed';
  readonly providerId: LlmProviderId;
  readonly modelId: string;
  readonly answer: string;
  readonly latencyMs: number;
} | {
  readonly outcome: 'cancelled';
} | {
  readonly outcome: 'failed';
  readonly providerId: LlmProviderId;
  readonly message: string;
};

export interface AnswerSendOptions {
  /** Aborted by the session lifecycle (stop or a superseding request). */
  readonly signal?: AbortSignal;
  readonly onSettled?: (settlement: AnswerSettlement) => void;
}

export interface AnswerSendFailure {
  readonly ok: false;
  readonly error: { readonly code: 'INVALID_REQUEST' | 'NOT_READY' | 'INTERNAL'; readonly message: string };
}

export type AnswerSendSuccess = { readonly ok: true };
export type AnswerSendResult = AnswerSendSuccess | AnswerSendFailure;

export interface AnswerSecretStore {
  isConfigured(providerId: string): boolean;
  withSecret<T>(providerId: string, useSecret: (secret: string) => T): T;
}

export interface AnswerProviderInfo {
  readonly id: LlmProviderId;
  readonly models?: readonly string[];
}

export interface AnswerServiceOptions {
  readonly providers: readonly AnswerProviderInfo[];
  readonly secretStore: AnswerSecretStore;
  readonly publish: (event: AnswerEvent) => void;
  readonly createAdapter?: (providerId: LlmProviderId, config: LlmProviderConfig) => LlmAdapter;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly historyLimit?: number;
  readonly timeoutMs?: number;
}

const SYSTEM_CONSTRAINTS = [
  'You are a live meeting copilot answering questions shown on screen.',
  'Answer concisely in plain prose with at most a few short sentences or bullets.',
  'Prefer facts visible in the conversation or screenshot; say when you are unsure.',
].join(' ');

const DEFAULT_MODELS: Record<LlmProviderId, string> = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  openrouter: 'openrouter/auto',
  opencode: 'ox-alpha',
};

const DEFAULT_MAX_INPUT_TOKENS = 12_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 700;
const DEFAULT_HISTORY_LIMIT = 12;

/**
 * Main-process answer pipeline. Streams provider completions as events, keeps
 * only an ephemeral in-memory history, and supersedes any in-flight request.
 */
export class AnswerService {
  private readonly providers: readonly AnswerProviderInfo[];
  private readonly secretStore: AnswerSecretStore;
  private readonly publish: (event: AnswerEvent) => void;
  private readonly createAdapter: (providerId: LlmProviderId, config: LlmProviderConfig) => LlmAdapter;
  private readonly maxInputTokens: number;
  private readonly maxOutputTokens: number;
  private readonly historyLimit: number;
  private readonly timeoutMs: number;
  private readonly history: ContextHistoryMessage[] = [];
  private abortController: AbortController | null = null;
  private activeRequestId: string | null = null;

  constructor(options: AnswerServiceOptions) {
    this.providers = options.providers;
    this.secretStore = options.secretStore;
    this.publish = options.publish;
    this.createAdapter = options.createAdapter ?? createLlmAdapter;
    this.maxInputTokens = options.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  send(request: AnswerRequest, options: AnswerSendOptions = {}): AnswerSendResult {
    const provider = this.providers.find(({ id }) => id === request.providerId);
    if (!provider) return failure('INVALID_REQUEST', 'Choose an answer provider that is listed.');
    if (!request.question.trim()) return failure('INVALID_REQUEST', 'Enter or capture a question first.');
    if (!this.secretStore.isConfigured(request.providerId)) {
      return failure('NOT_READY', 'Save an API key for this provider before asking for answers.');
    }

    this.abortController?.abort();
    const requestId = randomUUID();
    const controller = new AbortController();
    this.abortController = controller;
    this.activeRequestId = requestId;
    void this.stream(requestId, provider, request, controller, options);
    return { ok: true };
  }

  cancel(): void {
    this.abortController?.abort();
  }

  dispose(): void {
    this.cancel();
    this.history.length = 0;
  }

  private async stream(
    requestId: string,
    provider: AnswerProviderInfo,
    request: AnswerRequest,
    controller: AbortController,
    options: AnswerSendOptions,
  ): Promise<void> {
    const startedAt = Date.now();
    let settlement: AnswerSettlement = { outcome: 'cancelled' };
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });
    try {
      if (options.signal?.aborted) throw abortError();
      const model = this.resolveModel(provider, request.model);
      const config = this.secretStore.withSecret(provider.id, (apiKey) => ({
        apiKey,
        model,
        capabilities: ['text', 'image'] as const,
        timeoutMs: this.timeoutMs,
      }));
      const copilotRequest = buildCopilotRequest({
        systemConstraints: SYSTEM_CONSTRAINTS,
        currentQuestion: request.question,
        history: this.history,
        attachments: request.attachments?.map(({ id, mediaType, data }) => ({ id, mediaType, data })),
        maxInputTokens: this.maxInputTokens,
        maxOutputTokens: this.maxOutputTokens,
      });
      const adapter = this.createAdapter(provider.id, config);

      let answer = '';
      let completed = false;
      for await (const event of adapter.stream(copilotRequest, controller.signal)) {
        if (event.type === 'text-delta') {
          answer += event.text;
          this.publish({ type: 'answer-delta', text: event.text });
        } else if (event.type === 'completed') {
          completed = true;
        } else if (event.type === 'failed') {
          throw new Error(event.message);
        }
      }
      if (!completed || !answer.trim()) throw new Error('The provider ended without an answer.');

      this.history.push({ role: 'user', content: request.question }, { role: 'assistant', content: answer });
      while (this.history.length > this.historyLimit) this.history.shift();

      settlement = {
        outcome: 'completed',
        providerId: provider.id,
        modelId: model,
        answer,
        latencyMs: Date.now() - startedAt,
      };
      if (this.activeRequestId === requestId && !controller.signal.aborted) {
        this.publish({ type: 'answer-completed', model, latencyMs: settlement.latencyMs });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        settlement = { outcome: 'cancelled' };
        this.publish({ type: 'answer-cancelled' });
      } else {
        const message = error instanceof Error ? error.message : 'The answer request failed.';
        settlement = { outcome: 'failed', providerId: provider.id, message };
        this.publish({ type: 'answer-failed', message });
      }
    } finally {
      options.signal?.removeEventListener('abort', onExternalAbort);
      options.onSettled?.(settlement);
      if (this.activeRequestId === requestId) {
        this.activeRequestId = null;
        this.abortController = null;
      }
    }
  }

  private resolveModel(provider: AnswerProviderInfo, requested?: string): string {
    if (requested?.trim()) return requested.trim();
    return provider.models?.[0] ?? DEFAULT_MODELS[provider.id];
  }
}

function failure(code: AnswerSendFailure['error']['code'], message: string): AnswerSendFailure {
  return { ok: false, error: { code, message } };
}

function abortError(): DOMException {
  return new DOMException('The answer request was cancelled.', 'AbortError');
}
