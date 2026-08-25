import { BrowserWindow, screen, type Rectangle } from 'electron';
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
  createOverlayControls(window).setCaptureProtection(true);
  installOverlayContainment(window);
  void window.loadURL(LOCAL_APP_URL);

  return window;
}

export type CaptureProtectionStatus = { readonly status: 'best-effort' | 'unsupported' | 'disabled' };

type OverlayWindow = Pick<BrowserWindow,
  | 'setOpacity'
  | 'setIgnoreMouseEvents'
  | 'setAlwaysOnTop'
  | 'setContentProtection'
  | 'setFocusable'
  | 'hide'
  | 'showInactive'
  | 'isVisible'
  | 'isDestroyed'
>;

export function createOverlayControls(window: OverlayWindow) {
  return {
    setOpacity(opacity: number): void {
      if (!Number.isFinite(opacity) || opacity < 0.1 || opacity > 1) throw new Error('Invalid opacity.');
      window.setOpacity(opacity);
    },
    setClickThrough(enabled: boolean): void {
      window.setIgnoreMouseEvents(enabled, { forward: true });
    },
    setAlwaysOnTop(enabled: boolean): void {
      window.setAlwaysOnTop(enabled, 'floating');
    },
    setCaptureProtection(enabled: boolean): CaptureProtectionStatus {
      if (!enabled) {
        window.setContentProtection(false);
        return { status: 'disabled' };
      }
      try {
        window.setContentProtection(true);
        return { status: 'best-effort' };
      } catch {
        return { status: 'unsupported' };
      }
    },
    hide(): void {
      window.setFocusable(false);
      window.hide();
    },
  };
}

export function containOverlayBounds(bounds: Rectangle, workArea: Rectangle): Rectangle {
  const width = Math.min(Math.max(1, bounds.width), workArea.width);
  const height = Math.min(Math.max(1, bounds.height), workArea.height);
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height),
    width,
    height,
  };
}

export async function captureWithOverlayHidden<T>(
  window: Pick<OverlayWindow, 'hide' | 'showInactive' | 'isVisible' | 'isDestroyed'>,
  capture: () => Promise<T>,
  compositorDelayMs = 50,
): Promise<T> {
  const restore = window.isVisible();
  if (restore) {
    window.hide();
    await new Promise((resolve) => setTimeout(resolve, compositorDelayMs));
  }
  try {
    return await capture();
  } finally {
    if (restore && !window.isDestroyed()) window.showInactive();
  }
}

function installOverlayContainment(window: BrowserWindow): void {
  let correcting = false;
  const contain = () => {
    if (correcting || window.isDestroyed()) return;
    const bounds = window.getBounds();
    const contained = containOverlayBounds(bounds, screen.getDisplayMatching(bounds).workArea);
    if (Object.keys(contained).some((key) => contained[key as keyof Rectangle] !== bounds[key as keyof Rectangle])) {
      correcting = true;
      window.setBounds(contained);
      correcting = false;
    }
  };
  window.on('move', contain);
  window.on('resize', contain);
}
