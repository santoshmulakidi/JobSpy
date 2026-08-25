import { BrowserWindow } from 'electron';
import { join } from 'node:path';

import { installNavigationPolicy } from '../security/navigation-policy';

const LOCAL_CAPTURE_URL = 'copilot://app/index.html';

/** Dedicated hidden renderer for browser media APIs; it exposes no API to the overlay. */
export function createAudioCaptureWindow(): BrowserWindow {
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

  installNavigationPolicy(window);
  void window.loadURL(LOCAL_CAPTURE_URL);
  return window;
}
