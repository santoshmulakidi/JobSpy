import { beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (event: unknown, payload: unknown) => Promise<unknown>;

const handlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    }),
  },
}));

const trustedEvent = {
  senderFrame: {
    parent: null,
    url: 'copilot://app/index.html',
  },
};

const validStartRequest = {
  operationId: 'session-1',
  sttProviderId: 'deepgram',
  llmProviderId: 'openai',
  microphone: true,
  systemAudio: true,
  ephemeral: true,
};

describe('IPC boundary', () => {
  beforeEach(() => {
    handlers.clear();
    vi.resetModules();
  });

  it('rejects unknown channels without registering them', async () => {
    const { dispatchIpc, registerIpc } = await import('../../src/main/ipc/register-ipc');

    registerIpc();

    expect(handlers.has('system:exec')).toBe(false);
    await expect(dispatchIpc('system:exec', trustedEvent, {})).resolves.toEqual({
      ok: false,
      error: { code: 'UNKNOWN_CHANNEL', message: 'Unauthorized request.' },
    });
  });

  it('returns a sanitized invalid-request error for malformed payloads', async () => {
    const { registerIpc } = await import('../../src/main/ipc/register-ipc');

    registerIpc();
    const response = await handlers.get('session:start')?.(trustedEvent, {
      ...validStartRequest,
      microphone: 'yes',
    });

    expect(response).toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Invalid request.' },
    });
  });

  it('returns an unauthorized error for non-main-frame senders', async () => {
    const { registerIpc } = await import('../../src/main/ipc/register-ipc');

    registerIpc();
    const response = await handlers.get('session:start')?.(
      {
        senderFrame: {
          parent: {},
          url: 'copilot://app/index.html',
        },
      },
      validStartRequest,
    );

    expect(response).toEqual({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized request.' },
    });
  });

  it('returns an unauthorized error for non-local origins', async () => {
    const { registerIpc } = await import('../../src/main/ipc/register-ipc');

    registerIpc();
    const response = await handlers.get('session:start')?.(
      {
        senderFrame: {
          parent: null,
          url: 'https://attacker.example/',
        },
      },
      validStartRequest,
    );

    expect(response).toEqual({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized request.' },
    });
  });

  it('returns an unauthorized error for a local-scheme origin with a port', async () => {
    const { registerIpc } = await import('../../src/main/ipc/register-ipc');

    registerIpc();
    const response = await handlers.get('session:start')?.(
      {
        senderFrame: {
          parent: null,
          url: 'copilot://app:444/index.html',
        },
      },
      validStartRequest,
    );

    expect(response).toEqual({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized request.' },
    });
  });

  it('does not leak internal handler errors', async () => {
    const { registerIpc } = await import('../../src/main/ipc/register-ipc');

    registerIpc({
      'session:start': () => {
        throw new Error('provider key: should-never-reach-renderer');
      },
    });
    const response = await handlers.get('session:start')?.(trustedEvent, validStartRequest);

    expect(response).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Operation failed.' },
    });
    expect(JSON.stringify(response)).not.toContain('should-never-reach-renderer');
  });

  it('does not leak handler-supplied error details', async () => {
    const { registerIpc } = await import('../../src/main/ipc/register-ipc');

    registerIpc({
      'session:start': () => ({
        ok: false,
        error: { code: 'INTERNAL', message: 'provider key: should-never-reach-renderer' },
      }),
    });
    const response = await handlers.get('session:start')?.(trustedEvent, validStartRequest);

    expect(response).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Operation failed.' },
    });
    expect(JSON.stringify(response)).not.toContain('should-never-reach-renderer');
  });

  it('passes the authenticated sender to a narrow main-process operation', async () => {
    const { registerIpc } = await import('../../src/main/ipc/register-ipc');
    let observedEvent: unknown;

    registerIpc({
      'session:start': (_payload, event) => {
        observedEvent = event;
        return { ok: true };
      },
    });
    await handlers.get('session:start')?.(trustedEvent, validStartRequest);

    expect(observedEvent).toBe(trustedEvent);
  });

  it('validates screenshot edits and detailed preview responses', async () => {
    const { dispatchIpc } = await import('../../src/main/ipc/register-ipc');
    const preview = {
      id: 'shot-1',
      mediaType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
      width: 100,
      height: 80,
      expiresAt: Date.now() + 1000,
    };

    await expect(dispatchIpc('capture:preview', trustedEvent, { displayId: 'display-1' }, {
      'capture:preview': () => ({ ok: true, preview }),
    })).resolves.toEqual({ ok: true, preview });
    await expect(dispatchIpc('capture:confirm', trustedEvent, {
      captureId: 'shot-1',
      edits: { redactions: [{ x: -1, y: 0, width: 1, height: 1 }] },
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('rejects incomplete provider success, pruned channels, and unregistered history operations', async () => {
    const { dispatchIpc } = await import('../../src/main/ipc/register-ipc');

    await expect(dispatchIpc('providers:list', trustedEvent, undefined, {
      'providers:list': () => ({ ok: true }),
    })).resolves.toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    await expect(dispatchIpc('providers:test', trustedEvent, { providerId: 'openai' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } });
    await expect(dispatchIpc('session:pause', trustedEvent, undefined))
      .resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    await expect(dispatchIpc('session:pause', trustedEvent, { operationId: 'session-1' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    await expect(dispatchIpc('history:list', trustedEvent, undefined))
      .resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    await expect(dispatchIpc('history:list', trustedEvent, {}))
      .resolves.toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    await expect(dispatchIpc('history:export', trustedEvent, { sessionId: 'session-1', format: 'pdf' as never }))
      .resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('validates answer payloads and defaults unregistered answer channels to unavailable', async () => {
    const { dispatchIpc } = await import('../../src/main/ipc/register-ipc');

    await expect(dispatchIpc('answer:send', trustedEvent, undefined, {
      'answer:send': () => ({ ok: true }),
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    await expect(dispatchIpc('answer:send', trustedEvent, {
      providerId: 'openai',
      question: '',
    }, {
      'answer:send': () => ({ ok: true }),
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    await expect(dispatchIpc('answer:send', trustedEvent, {
      providerId: 'openai',
      question: 'What is the notice period?',
      model: 'gpt-test',
      screenshotId: 'shot-1',
    }, {
      'answer:send': () => ({ ok: true }),
    })).resolves.toEqual({ ok: true });
    await expect(dispatchIpc('answer:cancel', trustedEvent, undefined))
      .resolves.toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
  });
});
