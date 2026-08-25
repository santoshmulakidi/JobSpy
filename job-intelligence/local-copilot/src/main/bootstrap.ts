import {
  MessageChannelMain,
  app,
  desktopCapturer,
  nativeImage,
  net,
  protocol,
  screen,
  session,
  utilityProcess,
} from 'electron';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { captureWithOverlayHidden, createOverlayControls, createOverlayWindow } from './windows/overlay-window';
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
import {
  ScreenshotService,
  captureElectronDisplay,
  editScreenshotWithNativeImage,
  type ScreenshotEdits,
} from './capture/screenshot-service';
import { Database } from './storage/database';
import { SecretStore } from './storage/secrets';
import { AnswerService } from './answers/answer-service';
import type { ScreenshotAttachment } from './capture/screenshot-service';
import { createLlmAdapter, listLlmProviders, type LlmProviderId } from './providers/provider-registry';
import { COPILOT_EVENT_CHANNEL } from '../shared/contracts';

const LOCAL_SCHEME = 'copilot';
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob:",
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
  const overlayControls = createOverlayControls(overlayWindow);
  const screenshotService = new ScreenshotService({
    capture: (displayId) => captureWithOverlayHidden(
      overlayWindow,
      () => captureElectronDisplay({ desktopCapturer, screen }, displayId),
    ),
    edit: (screenshot, edits) => editScreenshotWithNativeImage(nativeImage, screenshot, edits),
  });
  const captureWindowHandle = createAudioCaptureWindow();
  await captureWindowHandle.ready;
  const captureWindow = captureWindowHandle.window;
  const permissionGate = new CapturePermissionGate(captureWindow.webContents);
  const sessionController = new SessionController();
  const userData = app.getPath('userData');
  const database = Database.open(join(userData, 'copilot.sqlite'));
  const secretStore = SecretStore.create({ database, directory: join(userData, 'secrets') });
  const llmProviders = listLlmProviders({ includeOptional: true });
  const providers = [
    { id: 'deepgram', kind: 'stt' as const, name: 'Deepgram', destination: 'Deepgram (audio leaves this device)', optional: false },
    { id: 'elevenlabs', kind: 'stt' as const, name: 'ElevenLabs', destination: 'ElevenLabs (audio leaves this device)', optional: false },
    ...llmProviders.map((provider) => ({
      ...provider,
      kind: 'llm' as const,
      name: ({ gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Anthropic', openrouter: 'OpenRouter', opencode: 'OpenCode' })[provider.id],
      ...(provider.id === 'opencode' ? { models: ['ox-alpha', 'ox-alpha-free'] } : {}),
    })),
  ];
  const answerService = new AnswerService({
    providers: llmProviders.map(({ id }) => ({
      id,
      ...(id === 'opencode' ? { models: ['ox-alpha', 'ox-alpha-free'] as const } : {}),
    })),
    secretStore,
    publish: (event) => overlayWindow.webContents.send(COPILOT_EVENT_CHANNEL, event),
    createAdapter: (providerId, config) => createLlmAdapter(providerId, config),
  });
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
      const request = payload as { operationId: string; microphone: boolean; systemAudio: boolean };
      await audioRuntime.start({ microphone: request.microphone, systemAudio: request.systemAudio });
      sessionController.dispatch({ type: 'start' });
      return { ok: true, operationId: request.operationId, snapshot: sessionSnapshot(sessionController) };
    },
    'session:stop': async (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) {
        return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized request.' } };
      }
      await audioRuntime.stop();
      sessionController.dispatch({ type: 'stop' });
      const request = payload as { operationId: string };
      return { ok: true, operationId: request.operationId, snapshot: sessionSnapshot(sessionController) };
    },
    'session:status': (_payload, event) => event.sender?.id === overlayWindow.webContents.id
      ? { ok: true, snapshot: sessionSnapshot(sessionController) }
      : unauthorizedResponse(),
    'providers:list': (_payload, event) => event.sender?.id === overlayWindow.webContents.id
      ? { ok: true, providers: providers.map((provider) => ({ ...provider, configured: secretStore.isConfigured(provider.id) })) }
      : unauthorizedResponse(),
    'providers:save-secret': (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      const request = payload as { providerId: string; secret: string };
      if (!providers.some(({ id }) => id === request.providerId)) return { ok: false, error: { code: 'INVALID_REQUEST' as const, message: 'Invalid request.' } };
      return { ok: true, status: secretStore.save(request.providerId, request.secret) };
    },
    'capture:preview': async (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      const request = payload as { displayId?: string };
      return { ok: true, preview: await screenshotService.preview(request.displayId) };
    },
    'capture:confirm': async (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      const request = payload as { captureId: string; edits?: ScreenshotEdits };
      return { ok: true, screenshot: await screenshotService.confirm(request.captureId, request.edits ?? {}) };
    },
    'capture:discard': (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      screenshotService.discard((payload as { captureId: string }).captureId);
      return { ok: true };
    },
    'overlay:set-opacity': (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      overlayControls.setOpacity((payload as { opacity: number }).opacity);
      return { ok: true };
    },
    'overlay:set-click-through': (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      overlayControls.setClickThrough((payload as { enabled: boolean }).enabled);
      return { ok: true };
    },
    'overlay:set-always-on-top': (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      overlayControls.setAlwaysOnTop((payload as { enabled: boolean }).enabled);
      return { ok: true };
    },
    'overlay:set-capture-protection': (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      return { ok: true, ...overlayControls.setCaptureProtection((payload as { enabled: boolean }).enabled) };
    },
    'overlay:hide': (_payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      overlayControls.hide();
      return { ok: true };
    },
    'overlay:move': (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      const request = payload as { x: number; y: number };
      overlayControls.move(request.x, request.y);
      return { ok: true };
    },
    'answer:send': async (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      const request = payload as { providerId: LlmProviderId; model?: string; question: string; screenshotId?: string };
      const send = async (attachments: readonly ScreenshotAttachment[]) => answerService.send({
        providerId: request.providerId,
        ...(request.model ? { model: request.model } : {}),
        question: request.question,
        attachments,
      });
      return request.screenshotId
        ? await screenshotService.withConfirmed([request.screenshotId], send)
        : await send([]);
    },
    'answer:cancel': (_payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      answerService.cancel();
      return { ok: true };
    },
  });

  captureWindow.webContents.on('render-process-gone', () => { void audioRuntime.stop(); });
  captureWindow.on('closed', () => { void audioRuntime.stop(); });
  app.once('before-quit', () => {
    screenshotService.dispose();
    answerService.dispose();
    database.close();
    void audioRuntime.stop();
  });
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

function unauthorizedResponse() {
  return { ok: false as const, error: { code: 'UNAUTHORIZED' as const, message: 'Unauthorized request.' } };
}

function sessionSnapshot(controller: SessionController) {
  const { phase, error } = controller.snapshot();
  return { phase, error };
}
