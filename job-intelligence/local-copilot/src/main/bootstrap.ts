import { app, net, protocol, session } from 'electron';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createOverlayWindow } from './windows/overlay-window';
import { registerIpc } from './ipc/register-ipc';

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
  registerIpc();
  createOverlayWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
