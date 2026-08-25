import {
  MessageChannelMain,
  app,
  desktopCapturer,
  net,
  protocol,
  session,
  utilityProcess,
} from 'electron';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createOverlayWindow } from './windows/overlay-window';
import { registerIpc } from './ipc/register-ipc';
import { CapturePermissionGate, installElectronLoopbackHandler } from '../audio/electron-loopback-handler';
import { createAudioCaptureWindow } from './windows/audio-capture-window';
import {
  AudioPipelineRuntime,
  asUtilityChild,
  resolveAudioUtilityEntry,
  type AudioPipelinePort,
} from './audio/audio-pipeline-runtime';
import { SessionController } from './sessions/session-controller';

const LOCAL_SCHEME = 'copilot';
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

app.enableSandbox();

function resolveRendererAsset(requestUrl: string): URL {
  const request = new URL(requestUrl);
  if (request.protocol !== `${LOCAL_SCHEME}:` || request.hostname !== 'app') {
    throw new Error('Only local copilot assets may be loaded.');
  }

  const rendererRoot = resolve(__dirname, '../renderer/main_window');
  const requestedPath = request.pathname === '/' ? '/index.html' : request.pathname;
  const assetPath = resolve(rendererRoot, `.${requestedPath}`);
  const assetRelativePath = relative(rendererRoot, assetPath);

  if (assetRelativePath.startsWith('..') || assetRelativePath.includes(':')) {
    throw new Error('Requested asset is outside the local renderer bundle.');
  }

  return pathToFileURL(assetPath);
}

function installContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });
}

app.whenReady().then(async () => {
  protocol.handle(LOCAL_SCHEME, (request) => net.fetch(resolveRendererAsset(request.url).toString()));
  installContentSecurityPolicy();
  const overlayWindow = createOverlayWindow();
  const captureWindowHandle = createAudioCaptureWindow();
  await captureWindowHandle.ready;
  const captureWindow = captureWindowHandle.window;
  const permissionGate = new CapturePermissionGate(captureWindow.webContents);
  const sessionController = new SessionController();
  installElectronLoopbackHandler(session.defaultSession, desktopCapturer, permissionGate);

  const audioRuntime = new AudioPipelineRuntime({
    captureWebContents: captureWindow.webContents,
    permissionGate,
    utilityEntryPath: resolveAudioUtilityEntry({
      isPackaged: app.isPackaged,
      buildDirectory: __dirname,
      appPath: app.getAppPath(),
    }),
    forkUtility: (entryPath) => asUtilityChild(utilityProcess.fork(entryPath, [], {
      env: utilityEnvironment(),
      serviceName: 'Copilot Audio Utility',
      stdio: 'ignore',
    })),
    createMessageChannel: () => new MessageChannelMain() as unknown as {
      port1: AudioPipelinePort;
      port2: AudioPipelinePort;
    },
    onFrame: (frame) => frame.pcm.fill(0),
    onFailure: (message) => {
      sessionController.dispatch({ type: 'utility-process-crashed', message });
    },
  });

  registerIpc({
    'session:start': async (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) {
        return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized request.' } };
      }
      const request = payload as { microphone: boolean; systemAudio: boolean };
      await audioRuntime.start({ microphone: request.microphone, systemAudio: request.systemAudio });
      sessionController.dispatch({ type: 'start' });
      return { ok: true };
    },
    'session:stop': async (_payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) {
        return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized request.' } };
      }
      await audioRuntime.stop();
      sessionController.dispatch({ type: 'stop' });
      return { ok: true };
    },
  });

  captureWindow.webContents.on('render-process-gone', () => { void audioRuntime.stop(); });
  captureWindow.on('closed', () => { void audioRuntime.stop(); });
  app.once('before-quit', () => { void audioRuntime.stop(); });
});

app.on('window-all-closed', () => {
  app.quit();
});

function utilityEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP']) {
    const value = process.env[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  return environment;
}
