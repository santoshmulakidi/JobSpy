import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CopilotApp } from '../../src/renderer/app';
import type { CopilotBridge, CopilotMainEventValue } from '../../src/shared/contracts';
import { createCopilotController, type UiPhase } from '../../src/renderer/copilot-controller';

type AnswerListener = (event: CopilotMainEventValue) => void;

function bridge(): CopilotBridge & { emitAnswerEvent(event: CopilotMainEventValue): void } {
  let phase: UiPhase = 'idle';
  let answerListener: AnswerListener | null = null;
  const sessionResponse = (operationId: string, next: UiPhase) => ({ ok: true as const, operationId, snapshot: { phase: phase = next, error: null } });
  return {
    session: {
      start: vi.fn(async ({ operationId }) => sessionResponse(operationId, 'capturing')),
      pause: vi.fn(async ({ operationId }) => sessionResponse(operationId, phase === 'paused' ? 'capturing' : 'paused')),
      stop: vi.fn(async ({ operationId }) => sessionResponse(operationId, 'stopped')),
      status: vi.fn(async () => ({ ok: true as const, snapshot: { phase, error: null } })),
    },
    providers: {
      list: vi.fn(async () => ({ ok: true as const, providers: [
        { id: 'deepgram', kind: 'stt' as const, name: 'Deepgram', destination: 'Deepgram (audio leaves this device)', optional: false, configured: false },
        { id: 'openai', kind: 'llm' as const, name: 'OpenAI', destination: 'OpenAI (requests leave this device)', optional: false, configured: false },
        { id: 'opencode', kind: 'llm' as const, name: 'OpenCode', destination: 'OpenCode (requests leave this device)', optional: true, configured: false, models: ['ox-alpha', 'ox-alpha-free'] },
      ] })),
      saveSecret: vi.fn(async ({ providerId }) => ({ ok: true as const, status: { providerId, configured: true } })),
    },
    capture: {
      preview: vi.fn(async () => ({ ok: true as const, preview: { id: 'shot-1', mediaType: 'image/png' as const, bytes: new Uint8Array([1]), width: 100, height: 80, expiresAt: Date.now() + 1_000 } })),
      confirm: vi.fn(async () => ({ ok: true as const, screenshot: { id: 'shot-1', width: 100, height: 80, edits: {} } })),
      discard: vi.fn(async () => ({ ok: true as const })),
    },
    history: {
      list: vi.fn(async (_request?: unknown) => ({ ok: true as const, sessions: [] })),
      remove: vi.fn(async (_request?: unknown) => ({ ok: true as const, receipt: { sessions: 1, turns: 2, screenshots: 0, recordings: 0 } })),
      purge: vi.fn(async () => ({ ok: true as const, receipt: { sessions: 3, turns: 6, screenshots: 1, recordings: 0 } })),
      export: vi.fn(async (_request?: unknown) => ({ ok: true as const, filename: 'copilot-session.md', content: '# Copilot session' })),
    },
    overlay: {
      setOpacity: vi.fn(async () => ({ ok: true as const })),
      setAlwaysOnTop: vi.fn(async () => ({ ok: true as const })),
      move: vi.fn(async () => ({ ok: true as const })),
      hide: vi.fn(async () => ({ ok: true as const })),
    },
    answer: {
      send: vi.fn(async (_request: unknown) => ({ ok: true as const })),
      cancel: vi.fn(async () => ({ ok: true as const })),
    },
    onAnswerEvent: vi.fn((listener: AnswerListener) => {
      answerListener = listener;
      return () => { answerListener = null; };
    }),
    emitAnswerEvent(event: CopilotMainEventValue) {
      answerListener?.(event);
    },
  };
}

describe('complete renderer journey', () => {
  it('loads disclosed providers, stores BYOK status without retaining the key, and flags OpenCode instability', async () => {
    const api = bridge();
    const controller = createCopilotController(api);
    await controller.load();
    await controller.saveProviderSecret('openai', 'sk-secret-that-must-not-be-retained');
    controller.selectLlmProvider('opencode');

    const state = controller.getState();
    expect(state.providers.find(({ id }) => id === 'openai')).toMatchObject({ configured: true });
    expect(JSON.stringify(state)).not.toContain('sk-secret-that-must-not-be-retained');
    expect(state.selectedModel).toBe('ox-alpha-free');
    expect(renderToStaticMarkup(<CopilotApp controller={controller} />)).toContain('experimental and may be unstable');
  });

  it('ignores duplicate session commands and a stale status response', async () => {
    const api = bridge();
    let releaseStatus!: (value: Awaited<ReturnType<typeof api.session.status>>) => void;
    api.session.status = vi.fn((): ReturnType<typeof api.session.status> => new Promise((resolve) => { releaseStatus = resolve; }));
    const controller = createCopilotController(api);
    const loading = controller.load();
    controller.selectSttProvider('deepgram');
    controller.selectLlmProvider('openai');

    const starting = controller.startSession();
    await controller.startSession();
    await starting;
    expect(controller.getState().phase).toBe('capturing');
    expect(api.session.start).toHaveBeenCalledOnce();
    releaseStatus({ ok: true, snapshot: { phase: 'idle', error: null } });
    await loading;
    expect(controller.getState().phase).toBe('capturing');
    await controller.stopSession();
    expect(controller.getState().phase).toBe('stopped');
  });

  it('streams a question into a sanitized answer with cancel and retry', async () => {
    const api = bridge();
    const controller = createCopilotController(api);
    await controller.load();
    await controller.startSession();

    expect(controller.getState().answerConnected).toBe(true);
    controller.editTranscript('What margin of safety does this role offer?');
    await controller.sendQuestion();

    const sent = vi.mocked(api.answer!.send).mock.calls[0]?.[0] as { providerId?: string; model?: string; question?: string };
    expect(sent).toMatchObject({ providerId: 'openai', question: 'What margin of safety does this role offer?' });
    expect(sent.model).toBeUndefined();
    expect(controller.getState()).toMatchObject({ answerPending: true, approvedScreenshotId: undefined });

    api.emitAnswerEvent({ type: 'answer-delta', text: '**Safe** partial' });
    api.emitAnswerEvent({ type: 'answer-delta', text: ' answer' });
    expect(controller.getState().answer).toBe('**Safe** partial answer');

    await controller.cancelAnswer();
    expect(api.answer!.cancel).toHaveBeenCalledOnce();
    api.emitAnswerEvent({ type: 'answer-cancelled' });
    expect(controller.getState()).toMatchObject({ answerPending: false });
    expect(controller.getState().message).toContain('cancelled');

    await controller.retryAnswer();
    api.emitAnswerEvent({ type: 'answer-delta', text: '**Safe** final' });
    api.emitAnswerEvent({ type: 'answer-completed', model: 'gpt-test', latencyMs: 42 });
    expect(controller.getState()).toMatchObject({ answerPending: false, model: 'gpt-test', latencyMs: 42 });

    const html = renderToStaticMarkup(<CopilotApp controller={controller} />);
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('<strong>Safe</strong>');
  });

  it('surfaces streamed failures without wedging the composer', async () => {
    const api = bridge();
    const controller = createCopilotController(api);
    await controller.load();
    await controller.startSession();
    controller.editTranscript('Why is the provider failing?');
    await controller.sendQuestion();

    api.emitAnswerEvent({ type: 'answer-failed', message: 'The provider request timed out.' });
    const state = controller.getState();
    expect(state).toMatchObject({ answerPending: false });
    expect(state.error).toContain('timed out');
    expect(renderToStaticMarkup(<CopilotApp controller={controller} />)).toContain('role="alert"');
  });

  it('keeps production answer controls disabled without a typed preload path', async () => {
    const api = bridge() as CopilotBridge;
    delete (api as { answer?: unknown }).answer;
    delete (api as { onAnswerEvent?: unknown }).onAnswerEvent;
    const controller = createCopilotController(api);
    controller.accept({ type: 'transcript-final', text: 'original question' });
    controller.editTranscript('edited question');
    await controller.sendQuestion();

    expect(controller.getState()).toMatchObject({ answerPending: false, answerConnected: false });
    expect(controller.getState().error).toContain('not connected');
  });

  it('renders streamed transcripts into the composer and surfaces transcription failures', async () => {
    const api = bridge();
    const controller = createCopilotController(api);
    await controller.load();

    api.emitAnswerEvent({ type: 'transcript-partial', text: 'What is the' });
    expect(controller.getState()).toMatchObject({ transcriptDraft: 'What is the', transcriptFinal: false });
    expect(renderToStaticMarkup(<CopilotApp controller={controller} />)).toContain('Listening');

    api.emitAnswerEvent({ type: 'transcript-final', text: 'What is the notice period?' });
    expect(controller.getState()).toMatchObject({ transcriptDraft: 'What is the notice period?', transcriptFinal: true });

    api.emitAnswerEvent({ type: 'transcript-partial', text: 'And is remote work' });
    expect(controller.getState()).toMatchObject({ transcriptDraft: 'What is the notice period? And is remote work', transcriptFinal: false });
    api.emitAnswerEvent({ type: 'transcript-final', text: 'And is remote work allowed?' });
    expect(controller.getState()).toMatchObject({
      transcriptDraft: 'What is the notice period? And is remote work allowed?',
      transcriptFinal: true,
    });

    controller.editTranscript('What is the notice period?');
    api.emitAnswerEvent({ type: 'transcript-final', text: 'Is it remote-friendly?' });
    expect(controller.getState()).toMatchObject({
      transcriptDraft: 'What is the notice period? Is it remote-friendly?',
      transcriptFinal: true,
    });

    api.emitAnswerEvent({ type: 'transcript-failed', message: 'The transcription provider quota was exceeded.' });
    const state = controller.getState();
    expect(state.error).toContain('quota');
    expect(renderToStaticMarkup(<CopilotApp controller={controller} />)).toContain('role="alert"');
  });

  it('pauses and resumes capture without losing the answer pipeline', async () => {
    const api = bridge();
    const controller = createCopilotController(api);
    await controller.load();
    await controller.startSession();

    await controller.togglePause();
    expect(controller.getState().phase).toBe('paused');
    expect(renderToStaticMarkup(<CopilotApp controller={controller} />)).toContain('Resume');

    await controller.togglePause();
    expect(controller.getState().phase).toBe('capturing');
    expect(vi.mocked(api.session.pause)).toHaveBeenCalledTimes(2);

    await controller.stopSession();
    expect(controller.getState().phase).toBe('stopped');
  });

  it('keeps an approved screenshot visible and removable', async () => {
    const api = bridge();
    const controller = createCopilotController(api);
    await controller.previewScreenshot();
    await controller.confirmScreenshot('shot-1', {});

    expect(controller.getState()).toMatchObject({ approvedScreenshotId: 'shot-1', screenshot: { id: 'shot-1' } });
    expect(renderToStaticMarkup(<CopilotApp controller={controller} />)).toContain('Screenshot approved for the next request');
    await controller.discardScreenshot('shot-1');
    expect(controller.getState().screenshot).toBeUndefined();
  });

  it('keeps saved sessions listed and exportable only when history is enabled', async () => {
    const api = bridge();
    const controller = createCopilotController(api);
    await controller.load();

    expect(renderToStaticMarkup(<CopilotApp controller={controller} />)).toContain('Sessions are ephemeral');

    await controller.startSession();
    expect(vi.mocked(api.session.start).mock.calls[0]?.[0]).toMatchObject({ ephemeral: true });

    controller.setPersistHistory(true);
    expect(vi.mocked(api.history.list)).toHaveBeenCalled();
    await controller.startSession();
    expect(vi.mocked(api.session.start).mock.lastCall?.[0]).toMatchObject({ ephemeral: false });

    controller.editTranscript('Is this offer safe?');
    await controller.sendQuestion();
    api.emitAnswerEvent({ type: 'answer-completed', model: 'gpt-test', latencyMs: 42 });
    await Promise.resolve();

    const sessions = [
      { sessionId: 'session-9', status: 'active', startedAt: '2026-08-25T10:00:00.000Z', endedAt: null, turnCount: 2, preview: 'Is this offer safe?' },
    ];
    vi.mocked(api.history.list).mockResolvedValue({ ok: true as const, sessions });
    await controller.loadHistory();

    const html = renderToStaticMarkup(<CopilotApp controller={controller} />);
    expect(html).toContain('Is this offer safe?');
    expect(html).toContain('2 turns');
    await controller.exportHistory('session-9', 'markdown');
    expect(api.history.export).toHaveBeenCalledWith({ sessionId: 'session-9', format: 'markdown' });
    await controller.deleteHistory('session-9');
    expect(api.history.remove).toHaveBeenCalledWith({ sessionId: 'session-9' });
  });

  it('purges every saved session and reports a count-only receipt', async () => {
    const api = bridge();
    const controller = createCopilotController(api);
    await controller.load();
    controller.setPersistHistory(true);

    expect(renderToStaticMarkup(<CopilotApp controller={controller} />)).toContain('Delete all');
    await controller.purgeHistory();

    expect(api.history.purge).toHaveBeenCalledTimes(1);
    expect(controller.getState().history).toEqual([]);
    expect(controller.getState().message).toBe('Deleted 3 sessions, 6 turns, 1 screenshot, and 0 recordings.');
  });

  it('exposes transcript announcements and keyboard move controls without claiming a shortcut', async () => {
    const controller = createCopilotController(bridge());
    controller.setTheme('dark');
    await controller.setOpacity(0.8);

    const html = renderToStaticMarkup(<CopilotApp controller={controller} />);
    expect(html).toContain('id="transcript"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-label="Move copilot overlay"');
    expect(html).toContain('aria-label="Move overlay left"');
    expect(html).toContain('Ctrl+Shift+Space toggles the overlay');
    expect(html).toContain('data-theme="dark"');
  });

});
