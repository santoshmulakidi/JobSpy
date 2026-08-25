import { describe, expect, it, vi } from 'vitest';

let creationOptions: { webPreferences: Record<string, unknown> } | undefined;

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function BrowserWindow(options) {
    creationOptions = options;
    return {
      loadURL: vi.fn(),
      webContents: {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
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
});
