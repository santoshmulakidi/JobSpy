import { BrowserWindow } from 'electron';
import { join } from 'node:path';

import { installNavigationPolicy } from '../security/navigation-policy';

const LOCAL_APP_URL = 'copilot://app/index.html';

export function createOverlayWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 640,
    height: 440,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false,
    },
  });

  installNavigationPolicy(window);
  void window.loadURL(LOCAL_APP_URL);

  return window;
}
