import type { ScreenshotEdits } from '../main/capture/screenshot-service';
import type { ScreenshotPreviewValue } from './features/session/screenshot-preview';

export type UiPhase = 'idle' | 'capturing' | 'paused' | 'generating' | 'error' | 'stopped';
export type UiTheme = 'system' | 'light' | 'dark';

export interface UiProvider {
  readonly id: string;
  readonly kind: 'stt' | 'llm';
  readonly name: string;
  readonly destination: string;
  readonly optional: boolean;
  readonly models?: readonly string[];
  readonly configured: boolean;
  readonly validated?: boolean;
}

interface Failure {
  readonly ok: false;
  readonly error: { readonly message: string };
}

interface SessionSuccess {
  readonly ok: true;
  readonly snapshot?: { readonly phase: UiPhase; readonly error: { readonly message: string } | null };
}

export interface CopilotUiBridge {
  readonly session: {
    start(request: { sttProviderId: string; llmProviderId: string; microphone: boolean; systemAudio: boolean; ephemeral: boolean }): Promise<SessionSuccess | Failure>;
    pause(): Promise<SessionSuccess | Failure>;
    stop(): Promise<SessionSuccess | Failure>;
    status(): Promise<SessionSuccess | Failure>;
  };
  readonly providers: {
    list(): Promise<{ readonly ok: true; readonly providers?: readonly UiProvider[] } | Failure>;
    test(request: { providerId: string }): Promise<{ readonly ok: true; readonly status?: { readonly providerId: string; readonly validated: boolean } } | Failure>;
    saveSecret(request: { providerId: string; secret: string }): Promise<{ readonly ok: true; readonly status?: { readonly providerId: string; readonly configured: boolean } } | Failure>;
  };
  readonly capture: {
    preview(request: { displayId?: string }): Promise<{ readonly ok: true; readonly preview: ScreenshotPreviewValue & { readonly expiresAt: number } } | Failure>;
    confirm(request: { captureId: string; edits?: ScreenshotEdits }): Promise<{ readonly ok: true; readonly screenshot?: unknown } | Failure>;
    discard(request: { captureId: string }): Promise<{ readonly ok: true } | Failure>;
  };
  readonly overlay: {
    setOpacity(request: { opacity: number }): Promise<{ readonly ok: true } | Failure>;
    setClickThrough(request: { enabled: boolean }): Promise<{ readonly ok: true } | Failure>;
    setAlwaysOnTop(request: { enabled: boolean }): Promise<{ readonly ok: true } | Failure>;
    setCaptureProtection(request: { enabled: boolean }): Promise<{ readonly ok: true; readonly status: 'best-effort' | 'unsupported' | 'disabled' } | Failure>;
    hide(): Promise<{ readonly ok: true } | Failure>;
  };
  readonly answer?: {
    send(question: string, screenshotId?: string): Promise<void>;
    cancel(): Promise<void>;
  };
}

export type CopilotUiEvent =
  | { readonly type: 'transcript-partial'; readonly text: string }
  | { readonly type: 'transcript-final'; readonly text: string }
  | { readonly type: 'answer-delta'; readonly text: string }
  | { readonly type: 'answer-completed'; readonly model: string; readonly latencyMs: number }
  | { readonly type: 'error'; readonly message: string };

export interface CopilotUiState {
  readonly loaded: boolean;
  readonly providers: readonly UiProvider[];
  readonly selectedSttProviderId: string;
  readonly selectedLlmProviderId: string;
  readonly selectedModel: string;
  readonly phase: UiPhase;
  readonly transcriptDraft: string;
  readonly transcriptFinal: boolean;
  readonly answer: string;
  readonly answerPending: boolean;
  readonly model?: string;
  readonly latencyMs?: number;
  readonly screenshot?: ScreenshotPreviewValue;
  readonly approvedScreenshotId?: string;
  readonly theme: UiTheme;
  readonly fontScale: number;
  readonly opacity: number;
  readonly clickThrough: boolean;
  readonly alwaysOnTop: boolean;
  readonly shortcut: string;
  readonly shortcutConflict: string;
  readonly message: string;
  readonly error: string;
  readonly answerConnected: boolean;
}

export interface CopilotController {
  getState(): CopilotUiState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  saveProviderSecret(providerId: string, secret: string): Promise<void>;
  testProvider(providerId: string): Promise<void>;
  selectSttProvider(providerId: string): void;
  selectLlmProvider(providerId: string): void;
  selectModel(model: string): void;
  startSession(): Promise<void>;
  togglePause(): Promise<void>;
  stopSession(): Promise<void>;
  accept(event: CopilotUiEvent): void;
  editTranscript(text: string): void;
  sendQuestion(): Promise<void>;
  retryAnswer(): Promise<void>;
  cancelAnswer(): Promise<void>;
  previewScreenshot(): Promise<void>;
  confirmScreenshot(id: string, edits: ScreenshotEdits): Promise<void>;
  discardScreenshot(id: string): Promise<void>;
  setTheme(theme: UiTheme): void;
  setFontScale(scale: number): void;
  setOpacity(opacity: number): Promise<void>;
  setClickThrough(enabled: boolean): Promise<void>;
  setAlwaysOnTop(enabled: boolean): Promise<void>;
  hide(): Promise<void>;
  setShortcut(shortcut: string, reserved?: readonly string[]): void;
}

const initialState: CopilotUiState = {
  loaded: false,
  providers: [],
  selectedSttProviderId: '',
  selectedLlmProviderId: '',
  selectedModel: '',
  phase: 'idle',
  transcriptDraft: '',
  transcriptFinal: false,
  answer: '',
  answerPending: false,
  theme: 'system',
  fontScale: 1,
  opacity: 1,
  clickThrough: false,
  alwaysOnTop: true,
  shortcut: 'Ctrl+Shift+Space',
  shortcutConflict: '',
  message: '',
  error: '',
  answerConnected: false,
};

export function createCopilotController(bridge: CopilotUiBridge): CopilotController {
  let state = { ...initialState, answerConnected: Boolean(bridge.answer) };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<CopilotUiState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const fail = (message: string) => publish({ error: message, message: '' });
  const applyResponse = (response: SessionSuccess | Failure, fallbackPhase?: UiPhase) => {
    if (!response.ok) return fail(response.error.message);
    publish({ phase: response.snapshot?.phase ?? fallbackPhase ?? state.phase, error: response.snapshot?.error?.message ?? '' });
  };

  const controller: CopilotController = {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async load() {
      const [providers, session] = await Promise.all([bridge.providers.list(), bridge.session.status()]);
      if (!providers.ok) fail(providers.error.message);
      else {
        const available = providers.providers ?? [];
        publish({
          providers: available,
          selectedSttProviderId: state.selectedSttProviderId || available.find(({ kind }) => kind === 'stt')?.id || '',
          selectedLlmProviderId: state.selectedLlmProviderId || available.find(({ kind, optional }) => kind === 'llm' && !optional)?.id || '',
        });
      }
      applyResponse(session);
      publish({ loaded: true });
    },
    async saveProviderSecret(providerId, secret) {
      if (!secret.trim()) return fail('Enter an API key before saving.');
      const response = await bridge.providers.saveSecret({ providerId, secret });
      if (!response.ok) return fail(response.error.message);
      publish({
        providers: state.providers.map((provider) => provider.id === providerId ? { ...provider, configured: response.status?.configured ?? true, validated: false } : provider),
        message: 'API key saved in Windows protected storage. The key is not displayed again.',
        error: '',
      });
    },
    async testProvider(providerId) {
      const response = await bridge.providers.test({ providerId });
      if (!response.ok) return fail(response.error.message);
      publish({
        providers: state.providers.map((provider) => provider.id === providerId ? { ...provider, validated: response.status?.validated ?? true } : provider),
        message: 'Provider connection validated.',
        error: '',
      });
    },
    selectSttProvider: (selectedSttProviderId) => publish({ selectedSttProviderId }),
    selectLlmProvider(selectedLlmProviderId) {
      const provider = state.providers.find(({ id }) => id === selectedLlmProviderId);
      publish({ selectedLlmProviderId, selectedModel: provider?.models?.includes('ox-alpha-free') ? 'ox-alpha-free' : provider?.models?.[0] ?? '' });
    },
    selectModel: (selectedModel) => publish({ selectedModel }),
    async startSession() {
      if (!state.selectedSttProviderId || !state.selectedLlmProviderId) return fail('Choose speech and answer providers first.');
      applyResponse(await bridge.session.start({
        sttProviderId: state.selectedSttProviderId,
        llmProviderId: state.selectedLlmProviderId,
        microphone: true,
        systemAudio: true,
        ephemeral: true,
      }), 'capturing');
    },
    async togglePause() {
      applyResponse(await bridge.session.pause(), state.phase === 'paused' ? 'capturing' : 'paused');
    },
    async stopSession() { applyResponse(await bridge.session.stop(), 'stopped'); },
    accept(event) {
      if (event.type === 'transcript-partial') publish({ transcriptDraft: event.text, transcriptFinal: false });
      else if (event.type === 'transcript-final') publish({ transcriptDraft: event.text, transcriptFinal: true });
      else if (event.type === 'answer-delta') publish({ answer: state.answer + event.text, answerPending: true });
      else if (event.type === 'answer-completed') publish({ answerPending: false, model: event.model, latencyMs: event.latencyMs });
      else fail(event.message);
    },
    editTranscript: (transcriptDraft) => publish({ transcriptDraft, transcriptFinal: true }),
    async sendQuestion() {
      const question = state.transcriptDraft.trim();
      if (!question) return fail('Enter or capture a question first.');
      if (!bridge.answer) return fail('Answer requests are not connected in this build.');
      publish({ answer: '', answerPending: true, error: '' });
      try { await bridge.answer.send(question, state.approvedScreenshotId); }
      catch { fail('The answer request could not be started.'); }
    },
    async retryAnswer() { await controller.sendQuestion(); },
    async cancelAnswer() {
      if (!bridge.answer) return fail('Answer cancellation is not connected in this build.');
      await bridge.answer.cancel();
      publish({ answerPending: false, message: 'Answer cancelled.' });
    },
    async previewScreenshot() {
      const response = await bridge.capture.preview({});
      if (!response.ok) return fail(response.error.message);
      publish({ screenshot: response.preview, error: '' });
    },
    async confirmScreenshot(id, edits) {
      const response = await bridge.capture.confirm({ captureId: id, edits });
      if (!response.ok) return fail(response.error.message);
      publish({ screenshot: undefined, approvedScreenshotId: response.screenshot ? id : undefined, message: response.screenshot ? 'Screenshot approved.' : 'Screenshot removed.' });
    },
    async discardScreenshot(id) {
      const response = await bridge.capture.discard({ captureId: id });
      if (!response.ok) return fail(response.error.message);
      publish({ screenshot: undefined, approvedScreenshotId: undefined, message: 'Screenshot discarded.' });
    },
    setTheme: (theme) => publish({ theme }),
    setFontScale: (fontScale) => publish({ fontScale: Math.min(1.4, Math.max(0.9, fontScale)) }),
    async setOpacity(opacity) {
      const response = await bridge.overlay.setOpacity({ opacity });
      if (!response.ok) return fail(response.error.message);
      publish({ opacity });
    },
    async setClickThrough(clickThrough) {
      const response = await bridge.overlay.setClickThrough({ enabled: clickThrough });
      if (!response.ok) return fail(response.error.message);
      publish({ clickThrough, message: clickThrough ? 'Click-through enabled. Use the global shortcut to return.' : '' });
    },
    async setAlwaysOnTop(alwaysOnTop) {
      const response = await bridge.overlay.setAlwaysOnTop({ enabled: alwaysOnTop });
      if (!response.ok) return fail(response.error.message);
      publish({ alwaysOnTop });
    },
    async hide() {
      const response = await bridge.overlay.hide();
      if (!response.ok) fail(response.error.message);
    },
    setShortcut(shortcut, reserved = []) {
      publish({ shortcut, shortcutConflict: reserved.includes(shortcut) ? `${shortcut} is already assigned by another command.` : '' });
    },
  };
  return controller;
}
