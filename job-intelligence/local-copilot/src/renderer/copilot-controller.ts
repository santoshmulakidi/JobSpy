import type { CopilotBridge, ProviderValue, ScreenshotEditsValue, ScreenshotPreviewValue } from '../shared/contracts';

export type UiPhase = 'idle' | 'capturing' | 'paused' | 'generating' | 'error' | 'stopped';
export type UiTheme = 'system' | 'light' | 'dark';
export type UiProvider = ProviderValue;
export type CopilotUiEvent = { readonly type: 'transcript-partial'; readonly text: string }
  | { readonly type: 'transcript-final'; readonly text: string }
  | { readonly type: 'transcript-failed'; readonly message: string }
  | { readonly type: 'answer-delta'; readonly text: string }
  | { readonly type: 'answer-completed'; readonly model: string; readonly latencyMs: number }
  | { readonly type: 'answer-failed'; readonly message: string }
  | { readonly type: 'answer-cancelled' }
  | { readonly type: 'error'; readonly message: string };

export interface CopilotUiState {
  readonly loaded: boolean; readonly providers: readonly UiProvider[];
  readonly selectedSttProviderId: string; readonly selectedLlmProviderId: string; readonly selectedModel: string;
  readonly phase: UiPhase; readonly sessionPending: boolean;
  readonly transcriptDraft: string; readonly transcriptFinal: boolean;
  readonly answer: string; readonly answerPending: boolean;
  readonly model?: string; readonly latencyMs?: number;
  readonly answerConnected: boolean;
  readonly screenshot?: ScreenshotPreviewValue; readonly approvedScreenshotId?: string;
  readonly theme: UiTheme; readonly fontScale: number; readonly opacity: number; readonly alwaysOnTop: boolean;
  readonly message: string; readonly error: string;
}

export interface CopilotController {
  getState(): CopilotUiState; subscribe(listener: () => void): () => void; load(): Promise<void>;
  saveProviderSecret(providerId: string, secret: string): Promise<void>;
  selectSttProvider(providerId: string): void; selectLlmProvider(providerId: string): void; selectModel(model: string): void;
  startSession(): Promise<void>; stopSession(): Promise<void>; accept(event: CopilotUiEvent): void;
  editTranscript(text: string): void; sendQuestion(): Promise<void>; retryAnswer(): Promise<void>;
  cancelAnswer(): Promise<void>; previewScreenshot(): Promise<void>;
  confirmScreenshot(id: string, edits: ScreenshotEditsValue): Promise<void>; discardScreenshot(id: string): Promise<void>;
  setTheme(theme: UiTheme): void; setFontScale(scale: number): void; setOpacity(opacity: number): Promise<void>;
  setAlwaysOnTop(enabled: boolean): Promise<void>; move(x: number, y: number): Promise<void>; hide(): Promise<void>;
}

const initialState: CopilotUiState = {
  loaded: false, providers: [], selectedSttProviderId: '', selectedLlmProviderId: '', selectedModel: '',
  phase: 'idle', sessionPending: false, transcriptDraft: '', transcriptFinal: false,
  answer: '', answerPending: false, answerConnected: false, theme: 'system', fontScale: 1,
  opacity: 1, alwaysOnTop: true, message: '', error: '',
};

export function createCopilotController(bridge: CopilotBridge): CopilotController {
  let state = { ...initialState, answerConnected: Boolean(bridge.answer && bridge.onAnswerEvent) };
  let sessionOperation = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<CopilotUiState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const fail = (message: string) => publish({ error: message, message: '' });
  const command = async (run: (operationId: string) => Promise<Awaited<ReturnType<CopilotBridge['session']['start']>>>) => {
    if (state.sessionPending) return;
    const identity = ++sessionOperation;
    const operationId = `session-${identity}`;
    publish({ sessionPending: true });
    try {
      const response = await run(operationId);
      if (identity !== sessionOperation) return;
      if (!response.ok) return fail(response.error.message);
      if (response.operationId !== operationId) return fail('Ignored a stale session response.');
      publish({ phase: response.snapshot.phase, error: response.snapshot.error?.message ?? '' });
    } finally { if (identity === sessionOperation) publish({ sessionPending: false }); }
  };
  const controller: CopilotController = {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async load() {
      bridge.onAnswerEvent?.((event) => controller.accept(event));
      const identity = sessionOperation;
      const [providers, session] = await Promise.all([bridge.providers.list(), bridge.session.status()]);
      if (!providers.ok) fail(providers.error.message);
      else publish({ providers: providers.providers,
        selectedSttProviderId: state.selectedSttProviderId || providers.providers.find(({ kind }) => kind === 'stt')?.id || '',
        selectedLlmProviderId: state.selectedLlmProviderId || providers.providers.find(({ kind, optional }) => kind === 'llm' && !optional)?.id || '' });
      if (identity === sessionOperation) {
        if (!session.ok) fail(session.error.message);
        else publish({ phase: session.snapshot.phase, error: session.snapshot.error?.message ?? '' });
      }
      publish({ loaded: true });
    },
    async saveProviderSecret(providerId, secret) {
      if (!secret.trim()) return fail('Enter an API key before saving.');
      const response = await bridge.providers.saveSecret({ providerId, secret });
      if (!response.ok) return fail(response.error.message);
      publish({ providers: state.providers.map((provider) => provider.id === providerId ? { ...provider, configured: response.status.configured } : provider),
        message: 'API key saved in Windows protected storage. The key is not displayed again.', error: '' });
    },
    selectSttProvider: (selectedSttProviderId) => publish({ selectedSttProviderId }),
    selectLlmProvider(selectedLlmProviderId) { const provider = state.providers.find(({ id }) => id === selectedLlmProviderId); publish({ selectedLlmProviderId, selectedModel: provider?.models?.includes('ox-alpha-free') ? 'ox-alpha-free' : provider?.models?.[0] ?? '' }); },
    selectModel: (selectedModel) => publish({ selectedModel }),
    async startSession() {
      if (!state.selectedSttProviderId || !state.selectedLlmProviderId) return fail('Choose speech and answer providers first.');
      await command((operationId) => bridge.session.start({ operationId, sttProviderId: state.selectedSttProviderId, llmProviderId: state.selectedLlmProviderId, microphone: true, systemAudio: true, ephemeral: true }));
    },
    async stopSession() { await command((operationId) => bridge.session.stop({ operationId })); },
    accept(event) {
      if (event.type === 'transcript-partial') publish({ transcriptDraft: event.text, transcriptFinal: false });
      else if (event.type === 'transcript-final') publish({ transcriptDraft: event.text, transcriptFinal: true });
      else if (event.type === 'transcript-failed') fail(event.message);
      else if (event.type === 'answer-delta') publish({ answer: state.answer + event.text, answerPending: true });
      else if (event.type === 'answer-completed') publish({ answerPending: false, model: event.model, latencyMs: event.latencyMs });
      else if (event.type === 'answer-cancelled') publish({ answerPending: false, message: 'Answer cancelled.' });
      else if (event.type === 'answer-failed') publish({ answerPending: false, error: event.message });
      else fail(event.message);
    },
    editTranscript: (transcriptDraft) => publish({ transcriptDraft, transcriptFinal: true }),
    async sendQuestion() {
      const question = state.transcriptDraft.trim();
      if (!question) return fail('Enter or capture a question first.');
      if (!bridge.answer || !bridge.onAnswerEvent) return fail('Answer requests are not connected in this build.');
      if (!state.selectedLlmProviderId) return fail('Choose an answer provider first.');
      const response = await bridge.answer.send({
        providerId: state.selectedLlmProviderId,
        ...(state.selectedModel ? { model: state.selectedModel } : {}),
        question,
        ...(state.approvedScreenshotId ? { screenshotId: state.approvedScreenshotId } : {}),
      });
      if (!response.ok) return fail(response.error.message);
      publish({ answer: '', answerPending: true, approvedScreenshotId: undefined, error: '' });
    },
    async retryAnswer() { await controller.sendQuestion(); },
    async cancelAnswer() {
      if (!bridge.answer) return fail('Answer cancellation is not connected in this build.');
      await bridge.answer.cancel();
    },
    async previewScreenshot() { const response = await bridge.capture.preview({}); if (!response.ok) return fail(response.error.message); publish({ screenshot: response.preview, approvedScreenshotId: undefined, error: '' }); },
    async confirmScreenshot(id, edits) { const response = await bridge.capture.confirm({ captureId: id, edits }); if (!response.ok) return fail(response.error.message); publish({ approvedScreenshotId: response.screenshot?.id, message: response.screenshot ? 'Screenshot approved for the next request.' : 'Screenshot removed.', ...(response.screenshot ? {} : { screenshot: undefined }) }); },
    async discardScreenshot(id) { const response = await bridge.capture.discard({ captureId: id }); if (!response.ok) return fail(response.error.message); publish({ screenshot: undefined, approvedScreenshotId: undefined, message: 'Screenshot discarded.' }); },
    setTheme: (theme) => publish({ theme }), setFontScale: (fontScale) => publish({ fontScale: Math.min(1.4, Math.max(.9, fontScale)) }),
    async setOpacity(opacity) { const response = await bridge.overlay.setOpacity({ opacity }); if (!response.ok) return fail(response.error.message); publish({ opacity }); },
    async setAlwaysOnTop(alwaysOnTop) { const response = await bridge.overlay.setAlwaysOnTop({ enabled: alwaysOnTop }); if (!response.ok) return fail(response.error.message); publish({ alwaysOnTop }); },
    async move(x, y) { const response = await bridge.overlay.move({ x, y }); if (!response.ok) fail(response.error.message); },
    async hide() { const response = await bridge.overlay.hide(); if (!response.ok) fail(response.error.message); },
  };
  return controller;
}
