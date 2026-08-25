import type { BrowserWindow } from 'electron';

export function installNavigationPolicy(window: BrowserWindow): void {
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
