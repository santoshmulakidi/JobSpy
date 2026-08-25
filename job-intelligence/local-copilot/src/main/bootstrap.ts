import {
  MessageChannelMain,
  app,
  desktopCapturer,
  dialog,
  globalShortcut,
  nativeImage,
  net,
  protocol,
  screen,
  session,
  utilityProcess,
} from 'electron';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
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
import { DiagnosticLog } from './diagnostics/diagnostic-log';
import {
  exportSessionJson,
  exportSessionMarkdown,
  HistoryRepository,
  historyExportFilename,
} from './storage/history-repository';
import { AnswerService } from './answers/answer-service';
import type { ScreenshotAttachment } from './capture/screenshot-service';
import { createLlmAdapter, listLlmProviders, type LlmProviderId, type SttProviderId } from './providers/provider-registry';
import { TranscriptionService } from './transcription/transcription-service';
import { COPILOT_EVENT_CHANNEL } from '../shared/contracts';
import { RecordingWriter } from '../audio/recording-writer';
import type { AudioSource } from '../audio/audio-frame';

const LOCAL_SCHEME = 'copilot';
const OVERLAY_TOGGLE_SHORTCUT = 'Control+Shift+Space';
const RECORDING_FOLDER_KEY = 'recording_folder';
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
  const history = new HistoryRepository(database);
  const diagnostics = new DiagnosticLog(database);
  const getRecordingFolderSetting = (): string | null => {
    const row = database.connection
      .prepare('SELECT value_json FROM app_settings WHERE setting_key = ?')
      .get(RECORDING_FOLDER_KEY) as { value_json: string } | undefined;
    if (!row) return null;
    try {
      const parsed: unknown = JSON.parse(row.value_json);
      return typeof parsed === 'string' && parsed.length > 0 ? parsed : null;
    } catch {
      return null;
    }
  };
  const setRecordingFolderSetting = (folder: string | null): void => {
    if (folder === null) {
      database.connection.prepare('DELETE FROM app_settings WHERE setting_key = ?').run(RECORDING_FOLDER_KEY);
      return;
    }
    database.connection
      .prepare(
        `INSERT INTO app_settings (setting_key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(RECORDING_FOLDER_KEY, JSON.stringify(folder), new Date().toISOString());
  };
  interface ActiveRecordings {
    readonly sessionId: string;
    readonly writers: Map<AudioSource, RecordingWriter>;
  }
  let activeRecordings: ActiveRecordings | null = null;
  const startRecording = (sessionId: string, sources: readonly AudioSource[]): boolean => {
    if (activeRecordings) return true;
    const folder = getRecordingFolderSetting();
    if (!folder) return false;
    const writers = new Map<AudioSource, RecordingWriter>();
    try {
      for (const source of sources) {
        writers.set(source, new RecordingWriter({ directory: folder, sessionId, source }));
      }
    } catch {
      for (const writer of writers.values()) writer.discard();
      diagnostics.record({ subsystem: 'recordings', eventType: 'recording-start-failed' });
      return false;
    }
    activeRecordings = { sessionId, writers };
    return true;
  };
  const stopRecording = (): void => {
    const recording = activeRecordings;
    activeRecordings = null;
    if (!recording) return;
    for (const writer of recording.writers.values()) {
      try {
        const closed = writer.close();
        if (closed && closed.framesWritten > 0) {
          history.addRecording(recording.sessionId, closed.fileReference);
        }
      } catch {
        writer.discard();
        diagnostics.record({ subsystem: 'recordings', eventType: 'recording-close-failed' });
      }
    }
  };
  const removeRecordingFiles = (sessionIds: readonly string[]): void => {
    if (sessionIds.length === 0) return;
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = database.connection
      .prepare(`SELECT file_reference FROM recordings WHERE session_id IN (${placeholders})`)
      .all(...sessionIds) as unknown as { file_reference: string }[];
    for (const row of rows) {
      try {
        unlinkSync(row.file_reference);
      } catch {
        // The file may already be gone; deletion proceeds regardless.
      }
    }
  };
  let activeHistorySessionId: string | null = null;
  const endActiveHistorySession = () => {
    stopRecording();
    if (activeHistorySessionId === null) return;
    history.endSession(activeHistorySessionId);
    activeHistorySessionId = null;
  };
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
  const transcriptionService = new TranscriptionService({
    publish: (event) => {
      if (event.type === 'transcript-failed') {
        diagnostics.record({ subsystem: 'transcription', eventType: 'transcription-failed' });
      }
      overlayWindow.webContents.send(COPILOT_EVENT_CHANNEL, event);
    },
  });
  const sttProviderIds = providers.filter(({ kind }) => kind === 'stt').map(({ id }) => id);
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
    onFrame: (frame) => {
      if (sessionController.snapshot().phase === 'paused') return;
      const writer = activeRecordings?.writers.get(frame.source);
      if (writer) {
        try {
          writer.writeFrame(frame);
        } catch {
          activeRecordings?.writers.delete(frame.source);
          diagnostics.record({ subsystem: 'recordings', eventType: 'recording-write-failed' });
        }
      }
      transcriptionService.handleFrame(frame);
    },
    onFailure: (message) => {
      void transcriptionService.stop();
      endActiveHistorySession();
      diagnostics.record({ subsystem: 'audio', eventType: 'utility-process-failed', metadata: { message } });
      sessionController.dispatch({ type: 'utility-process-crashed', message });
    },
  });

  registerIpc({
    'session:start': async (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) {
        return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized request.' } };
      }
      const request = payload as { operationId: string; sttProviderId: string; microphone: boolean; systemAudio: boolean; ephemeral: boolean; recordAudio?: boolean };
      if (!sttProviderIds.includes(request.sttProviderId)) {
        return { ok: false, error: { code: 'INVALID_REQUEST' as const, message: 'Invalid request.' } };
      }
      if (!secretStore.isConfigured(request.sttProviderId)) {
        return { ok: false, error: { code: 'NOT_READY' as const, message: 'Operation is not available.' } };
      }
      await audioRuntime.start({ microphone: request.microphone, systemAudio: request.systemAudio });
      try {
        const apiKey = secretStore.withSecret(request.sttProviderId, (secret) => secret);
        await transcriptionService.start(request.sttProviderId as SttProviderId, apiKey);
      } catch {
        await audioRuntime.stop();
        return { ok: false, error: { code: 'INTERNAL' as const, message: 'Operation failed.' } };
      }
      sessionController.dispatch({ type: 'start' });
      activeHistorySessionId = request.ephemeral
        ? null
        : history.startSession({ microphone: request.microphone, systemAudio: request.systemAudio, sttProviderId: request.sttProviderId });
      if (activeHistorySessionId && request.recordAudio === true) {
        const sources: AudioSource[] = [
          ...(request.microphone ? ['microphone' as const] : []),
          ...(request.systemAudio ? ['system' as const] : []),
        ];
        startRecording(activeHistorySessionId, sources);
      }
      return { ok: true, operationId: request.operationId, snapshot: sessionSnapshot(sessionController) };
    },
    'session:pause': (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      const request = payload as { operationId: string };
      const phase = sessionController.snapshot().phase;
      sessionController.dispatch({ type: phase === 'paused' ? 'resume' : 'pause' });
      return { ok: true, operationId: request.operationId, snapshot: sessionSnapshot(sessionController) };
    },
    'session:stop': async (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) {
        return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized request.' } };
      }
      await Promise.allSettled([audioRuntime.stop(), transcriptionService.stop()]);
      endActiveHistorySession();
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
    'overlay:set-always-on-top': (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      overlayControls.setAlwaysOnTop((payload as { enabled: boolean }).enabled);
      return { ok: true };
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
      const phase = sessionController.snapshot().phase;
      if (phase !== 'capturing' && phase !== 'generating') {
        return { ok: false, error: { code: 'NOT_READY' as const, message: 'Operation is not available.' } };
      }
      const requestId = randomUUID();
      const generationEvents = sessionController.events()[Symbol.asyncIterator]();
      sessionController.dispatch({ type: 'generate', requestId });
      if (sessionController.snapshot().generation?.requestId !== requestId) {
        return { ok: false, error: { code: 'NOT_READY' as const, message: 'Operation is not available.' } };
      }
      const started = await generationEvents.next();
      await generationEvents.return?.();
      const startedEvent = started.done ? undefined : started.value;
      const signal = startedEvent && (startedEvent.type === 'generation-started' || startedEvent.type === 'generation-superseded')
        ? startedEvent.signal
        : undefined;
      const send = async (attachments: readonly ScreenshotAttachment[]) => {
        const result = answerService.send({
          providerId: request.providerId,
          ...(request.model ? { model: request.model } : {}),
          question: request.question,
          attachments,
        }, {
          signal,
          onSettled: (settlement) => {
            if (activeHistorySessionId) {
              if (settlement.outcome === 'completed') {
                history.addModelTurn(activeHistorySessionId, {
                  providerId: settlement.providerId,
                  modelId: settlement.modelId,
                  status: 'completed',
                  text: settlement.answer,
                  latencyMs: settlement.latencyMs,
                });
              } else if (settlement.outcome === 'failed') {
                history.addModelTurn(activeHistorySessionId, {
                  providerId: settlement.providerId,
                  status: 'failed',
                  text: '',
                });
                diagnostics.record({
                  subsystem: 'answers',
                  eventType: 'generation-failed',
                  metadata: { providerId: settlement.providerId },
                });
              }
            }
            sessionController.dispatch({ type: 'generation-completed', requestId });
          },
        });
        if (result.ok && activeHistorySessionId) {
          history.addUserTurn(activeHistorySessionId, request.question);
        }
        return result;
      };
      return request.screenshotId
        ? await screenshotService.withConfirmed([request.screenshotId], send)
        : await send([]);
    },
    'answer:cancel': (_payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      answerService.cancel();
      return { ok: true };
    },
    'history:list': (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      const request = payload as { limit?: number };
      return { ok: true, sessions: history.listSessions(request.limit) };
    },
    'history:delete': (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      const sessionId = (payload as { sessionId: string }).sessionId;
      removeRecordingFiles([sessionId]);
      const receipt = history.deleteSession(sessionId);
      if (!receipt) return { ok: false, error: { code: 'INVALID_REQUEST' as const, message: 'Invalid request.' } };
      return { ok: true, receipt };
    },
    'history:purge': (_payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      const allSessionIds = (
        database.connection.prepare('SELECT session_id FROM sessions').all() as unknown as { session_id: string }[]
      ).map(({ session_id }) => session_id);
      removeRecordingFiles(allSessionIds);
      return { ok: true, receipt: history.purgeAll() };
    },
    'settings:get-recording-folder': (_payload, event) => event.sender?.id === overlayWindow.webContents.id
      ? { ok: true, folder: getRecordingFolderSetting() }
      : unauthorizedResponse(),
    'settings:set-recording-folder': async (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      const action = (payload as { action: 'choose' | 'clear' }).action;
      if (action === 'clear') {
        setRecordingFolderSetting(null);
        return { ok: true, folder: null };
      }
      const result = await dialog.showOpenDialog(overlayWindow, {
        title: 'Choose recordings folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      const [chosen] = result.filePaths;
      if (!result.canceled && chosen) {
        setRecordingFolderSetting(chosen);
      }
      return { ok: true, folder: getRecordingFolderSetting() };
    },
    'history:export': (payload, event) => {
      if (event.sender?.id !== overlayWindow.webContents.id) return unauthorizedResponse();
      const request = payload as { sessionId: string; format: 'json' | 'markdown' };
      const detail = history.getSession(request.sessionId);
      if (!detail) return { ok: false, error: { code: 'INVALID_REQUEST' as const, message: 'Invalid request.' } };
      return {
        ok: true,
        filename: historyExportFilename(detail, request.format),
        content: request.format === 'json' ? exportSessionJson(detail) : exportSessionMarkdown(detail),
      };
    },
  });

  captureWindow.webContents.on('render-process-gone', () => {
    void audioRuntime.stop();
    void transcriptionService.stop();
    endActiveHistorySession();
  });
  captureWindow.on('closed', () => {
    void audioRuntime.stop();
    void transcriptionService.stop();
    endActiveHistorySession();
  });
  const overlayShortcutRegistered = globalShortcut.register(OVERLAY_TOGGLE_SHORTCUT, () => {
    if (overlayWindow.isDestroyed()) return;
    if (overlayWindow.isVisible()) overlayControls.hide();
    else overlayWindow.showInactive();
  });
  app.once('before-quit', () => {
    if (overlayShortcutRegistered) globalShortcut.unregister(OVERLAY_TOGGLE_SHORTCUT);
    screenshotService.dispose();
    answerService.dispose();
    transcriptionService.dispose();
    endActiveHistorySession();
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
