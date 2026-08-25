import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CopilotApp } from '../../src/renderer/app';
import {
  createCopilotController,
  type CopilotUiBridge,
  type UiPhase,
} from '../../src/renderer/copilot-controller';

function bridge(): CopilotUiBridge {
  let phase: UiPhase = 'idle';
  const sessionResponse = (next: UiPhase) => ({ ok: true as const, snapshot: { phase: phase = next, error: null } });
  return {
    session: {
      start: vi.fn(async () => sessionResponse('capturing')),
      pause: vi.fn(async () => sessionResponse(phase === 'paused' ? 'capturing' : 'paused')),
      stop: vi.fn(async () => sessionResponse('stopped')),
      status: vi.fn(async () => ({ ok: true as const, snapshot: { phase, error: null } })),
    },
    providers: {
      list: vi.fn(async () => ({ ok: true as const, providers: [
        { id: 'deepgram', kind: 'stt' as const, name: 'Deepgram', destination: 'Deepgram (audio leaves this device)', optional: false, configured: false },
        { id: 'openai', kind: 'llm' as const, name: 'OpenAI', destination: 'OpenAI (requests leave this device)', optional: false, configured: false },
        { id: 'opencode', kind: 'llm' as const, name: 'OpenCode', destination: 'OpenCode (requests leave this device)', optional: true, configured: false, models: ['ox-alpha', 'ox-alpha-free'] },
      ] })),
      saveSecret: vi.fn(async ({ providerId }) => ({ ok: true as const, status: { providerId, configured: true } })),
      test: vi.fn(async ({ providerId }) => ({ ok: true as const, status: { providerId, validated: true } })),
    },
    capture: {
      preview: vi.fn(async () => ({ ok: true as const, preview: { id: 'shot-1', mediaType: 'image/png' as const, bytes: new Uint8Array([1]), width: 100, height: 80, expiresAt: Date.now() + 1_000 } })),
      confirm: vi.fn(async () => ({ ok: true as const, screenshot: { id: 'shot-1', width: 100, height: 80, edits: {} } })),
      discard: vi.fn(async () => ({ ok: true as const })),
    },
    overlay: {
      setOpacity: vi.fn(async () => ({ ok: true as const })),
      setClickThrough: vi.fn(async () => ({ ok: true as const })),
      setAlwaysOnTop: vi.fn(async () => ({ ok: true as const })),
      setCaptureProtection: vi.fn(async () => ({ ok: true as const, status: 'best-effort' as const })),
      hide: vi.fn(async () => ({ ok: true as const })),
    },
    answer: {
      send: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    },
  };
}

describe('complete renderer journey', () => {
  it('loads disclosed providers, stores BYOK status without retaining the key, and flags OpenCode instability', async () => {
    const api = bridge();
    const controller = createCopilotController(api);
    await controller.load();
    await controller.saveProviderSecret('openai', 'sk-secret-that-must-not-be-retained');
    await controller.testProvider('openai');
    controller.selectLlmProvider('opencode');

    const state = controller.getState();
    expect(state.providers.find(({ id }) => id === 'openai')).toMatchObject({ configured: true, validated: true });
    expect(JSON.stringify(state)).not.toContain('sk-secret-that-must-not-be-retained');
    expect(state.selectedModel).toBe('ox-alpha-free');
    expect(renderToStaticMarkup(<CopilotApp controller={controller} />)).toContain('experimental and may be unstable');
  });

  it('starts, pauses, resumes, and stops only after successful bridge responses', async () => {
    const api = bridge();
    const controller = createCopilotController(api);
    await controller.load();
    controller.selectSttProvider('deepgram');
    controller.selectLlmProvider('openai');

    await controller.startSession();
    expect(controller.getState().phase).toBe('capturing');
    await controller.togglePause();
    expect(controller.getState().phase).toBe('paused');
    await controller.togglePause();
    expect(controller.getState().phase).toBe('capturing');
    await controller.stopSession();
    expect(controller.getState().phase).toBe('stopped');
  });

  it('edits a final transcript before send, renders streamed answers, and supports cancel and retry', async () => {
    const api = bridge();
    const controller = createCopilotController(api);
    controller.accept({ type: 'transcript-final', text: 'original question' });
    controller.editTranscript('edited question');
    await controller.sendQuestion();
    controller.accept({ type: 'answer-delta', text: '**Safe** answer' });
    controller.accept({ type: 'answer-completed', model: 'gpt-test', latencyMs: 42 });

    expect(api.answer?.send).toHaveBeenCalledWith('edited question', undefined);
    expect(controller.getState()).toMatchObject({ answer: '**Safe** answer', model: 'gpt-test', latencyMs: 42 });
    await controller.retryAnswer();
    await controller.cancelAnswer();
    expect(api.answer?.send).toHaveBeenLastCalledWith('edited question', undefined);
    expect(api.answer?.cancel).toHaveBeenCalledOnce();
  });

  it('requires screenshot approval and exposes accessible live, theme, resize, and shortcut-conflict surfaces', async () => {
    const api = bridge();
    const controller = createCopilotController(api);
    await controller.previewScreenshot();
    await controller.confirmScreenshot('shot-1', {});
    controller.setShortcut('Ctrl+Shift+Space');
    controller.setShortcut('Ctrl+Shift+Space', ['Ctrl+Shift+Space']);
    controller.setTheme('dark');
    await controller.setOpacity(0.8);

    expect(api.capture.confirm).toHaveBeenCalled();
    expect(controller.getState().shortcutConflict).toContain('already assigned');
    const html = renderToStaticMarkup(<CopilotApp controller={controller} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-label="Move copilot overlay"');
    expect(html).toContain('data-theme="dark"');
  });
});
