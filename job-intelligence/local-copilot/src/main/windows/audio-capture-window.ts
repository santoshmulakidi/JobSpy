import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';

import { installNavigationPolicy } from '../security/navigation-policy';

const LOCAL_CAPTURE_URL = 'copilot://app/index.html';

/** Dedicated hidden renderer for browser media APIs; it exposes no API to the overlay. */
export interface AudioCaptureWindowHandle {
  readonly window: BrowserWindow;
  readonly ready: Promise<void>;
}

export function createAudioCaptureWindow(): AudioCaptureWindowHandle {
  const window = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'capture-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
      devTools: false,
    },
  });

  let loadReady = false;
  let preloadReady = false;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  const finishIfReady = () => {
    if (!loadReady || !preloadReady) return;
    ipcMain.off('audio:capture-preload-ready', onPreloadReady);
    resolveReady();
  };
  const onPreloadReady = (event: { sender: unknown }) => {
    if (event.sender !== window.webContents) return;
    preloadReady = true;
    finishIfReady();
  };
  ipcMain.on('audio:capture-preload-ready', onPreloadReady);
  window.webContents.once('did-finish-load', () => {
    loadReady = true;
    finishIfReady();
  });

  installNavigationPolicy(window);
  void window.loadURL(LOCAL_CAPTURE_URL);
  return { window, ready };
}
