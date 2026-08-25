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
});
