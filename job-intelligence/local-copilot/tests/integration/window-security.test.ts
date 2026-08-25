import { describe, expect, it, vi } from 'vitest';

let creationOptions: { show?: boolean; webPreferences: Record<string, unknown> } | undefined;
let createdWebContents: {
  id: number;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
} | undefined;
let preloadReady: ((event: { sender: unknown }) => void) | undefined;
let didFinishLoad: (() => void) | undefined;

vi.mock('electron', () => ({
  screen: { on: vi.fn(), off: vi.fn() },
  ipcMain: {
    on: vi.fn((channel: string, listener: typeof preloadReady) => {
      if (channel === 'audio:capture-preload-ready') preloadReady = listener;
    }),
    off: vi.fn(),
  },
  BrowserWindow: vi.fn(function BrowserWindow(options) {
    creationOptions = options;
    createdWebContents = {
      id: 17,
      on: vi.fn(),
      once: vi.fn((event: string, listener: () => void) => {
        if (event === 'did-finish-load') didFinishLoad = listener;
      }),
      setWindowOpenHandler: vi.fn(),
    };
    return {
      loadURL: vi.fn(),
      webContents: createdWebContents,
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      getBounds: vi.fn(),
      setBounds: vi.fn(),
      isDestroyed: vi.fn(() => false),
      setContentProtection: vi.fn(),
    };
  }),
}));

describe('packaged overlay window security', () => {
  it('disables Node, isolates the context, and enables the sandbox', async () => {
    const { createOverlayWindow } = await import('../../src/main/windows/overlay-window');

    createOverlayWindow();

    const prefs = creationOptions?.webPreferences;
    expect(prefs?.nodeIntegration).toBe(false);
    expect(prefs?.contextIsolation).toBe(true);
    expect(prefs?.sandbox).toBe(true);
  });

  it('blocks navigations and denies new windows', async () => {
    const { installNavigationPolicy } = await import('../../src/main/security/navigation-policy');
    const callbacks: {
      navigation?: (event: { preventDefault: () => void }) => void;
      open?: () => unknown;
    } = {};
    const window = {
      webContents: {
        on: vi.fn((event: string, listener: (event: { preventDefault: () => void }) => void) => {
          if (event === 'will-navigate') {
            callbacks.navigation = listener;
          }
        }),
        setWindowOpenHandler: vi.fn((listener: () => unknown) => {
          callbacks.open = listener;
        }),
      },
    };
    const event = { preventDefault: vi.fn() };

    installNavigationPolicy(window as never);
    callbacks.navigation?.(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(callbacks.open?.()).toEqual({ action: 'deny' });
  });

  it('creates a hidden sandboxed capture renderer with a dedicated preload', async () => {
    const { createAudioCaptureWindow } = await import('../../src/main/windows/audio-capture-window');

    createAudioCaptureWindow();

    expect(creationOptions).toMatchObject({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        devTools: false,
      },
    });
    expect(creationOptions?.webPreferences.preload).toMatch(/capture-preload\.js$/);
  });

  it('becomes ready only after load and an exact capture-preload handshake', async () => {
    const { createAudioCaptureWindow } = await import('../../src/main/windows/audio-capture-window');

    const handle = createAudioCaptureWindow();
    let ready = false;
    void handle.ready.then(() => { ready = true; });
    didFinishLoad?.();
    await Promise.resolve();
    expect(ready).toBe(false);

    preloadReady?.({ sender: { id: 99 } });
    await Promise.resolve();
    expect(ready).toBe(false);
    preloadReady?.({ sender: createdWebContents });
    await handle.ready;

    expect(ready).toBe(true);
  });
});
