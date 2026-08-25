const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const {
  app, BrowserWindow, ipcMain, MessageChannelMain, protocol, utilityProcess,
} = require('electron');

const workingRoot = resolve(__dirname, '..', '..');
const usePackagedEntry = process.argv.includes('packaged');
const packagedApp = join(
  workingRoot,
  'out',
  'local-windows-ai-copilot-win32-x64',
  'resources',
  'app.asar',
);
const utilityEntry = usePackagedEntry
  ? join(packagedApp, '.vite', 'build', 'audio-utility.js')
  : join(workingRoot, '.vite', 'build', 'audio-utility.js');
const capturePreload = usePackagedEntry
  ? join(packagedApp, '.vite', 'build', 'capture-preload.js')
  : join(workingRoot, '.vite', 'build', 'capture-preload.js');
const runtimeEntry = usePackagedEntry
  ? join(packagedApp, '.vite', 'build', 'audio-pipeline-runtime.cjs')
  : join(workingRoot, '.vite', 'build', 'audio-pipeline-runtime.cjs');
const crashEntry = join(__dirname, 'audio-crash-fixture.cjs');
const userData = mkdtempSync(join(tmpdir(), 'copilot-audio-electron-'));
const { AudioPipelineRuntime } = require(runtimeEntry);

app.setPath('userData', userData);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{
  scheme: 'copilot',
  privileges: { standard: true, secure: true },
}]);
app.once('quit', () => {
  try { rmSync(userData, { recursive: true, force: true }); } catch {}
});

let timeout;
let window;
const liveChildren = new Set();

function fail(error) {
  clearTimeout(timeout);
  for (const child of liveChildren) {
    try { child.kill(); } catch {}
  }
  try { window?.destroy(); } catch {}
  process.stderr.write(`${error?.stack ?? error}\n`);
  app.exit(1);
}

function waitForPreloadReady(webContents) {
  return new Promise((resolveReady) => {
    const onReady = (event) => {
      if (event.sender !== webContents) return;
      ipcMain.off('audio:capture-preload-ready', onReady);
      resolveReady();
    };
    ipcMain.on('audio:capture-preload-ready', onReady);
  });
}

async function waitFor(predicate, message, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!await predicate() && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.ok(await predicate(), message);
}

function createRendererResourceProbe(webContents) {
  const contexts = [];
  webContents.debugger.attach('1.3');
  webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Runtime.executionContextCreated') contexts.push(params.context);
  });
  const enable = webContents.debugger.sendCommand('Runtime.enable');
  const evaluate = (contextId, expression) => webContents.debugger.sendCommand('Runtime.evaluate', {
    contextId,
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return {
    async install() {
      await enable;
      const context = contexts.findLast(({ name }) => name === 'Electron Isolated Context');
      assert.ok(context, `missing preload execution context: ${contexts.map(({ name }) => name).join(', ')}`);
      await evaluate(context.id, `(() => {
        const state = { tracks: [], contexts: [], stopCalls: 0, closeCalls: 0 };
        const mediaDevices = navigator.mediaDevices;
        const getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
        Object.defineProperty(mediaDevices, 'getUserMedia', {
          configurable: true,
          value: async (...args) => {
            const stream = await getUserMedia(...args);
            state.tracks.push(...stream.getTracks());
            return stream;
          },
        });
        const NativeAudioContext = globalThis.AudioContext;
        globalThis.AudioContext = class extends NativeAudioContext {
          constructor(...args) {
            super(...args);
            state.contexts.push(this);
          }
          close() {
            state.closeCalls += 1;
            return super.close();
          }
        };
        const stop = MediaStreamTrack.prototype.stop;
        MediaStreamTrack.prototype.stop = function() {
          state.stopCalls += 1;
          return stop.call(this);
        };
        globalThis.__audioCaptureHarness = state;
      })()`);
      this.contextId = context.id;
    },
    async snapshot() {
      const result = await evaluate(this.contextId, `(() => {
        const state = globalThis.__audioCaptureHarness;
        return {
          tracks: state.tracks.map((track) => track.readyState),
          contexts: state.contexts.map((context) => context.state),
          stopCalls: state.stopCalls,
          closeCalls: state.closeCalls,
        };
      })()`);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    },
    detach() {
      if (webContents.debugger.isAttached()) webContents.debugger.detach();
    },
  };
}

function createRuntime(options = {}) {
  let forcedKills = 0;
  let child;
  const frames = [];
  const messages = [];
  const heldAcks = [];
  let processHandle;
  let resolveExit;
  const exited = new Promise((resolveExited) => { resolveExit = resolveExited; });
  const gate = {
    lifecycle: null,
    authorize(lifecycle) { this.lifecycle = lifecycle; },
    revoke(lifecycle) {
      if (lifecycle === undefined || lifecycle === this.lifecycle) this.lifecycle = null;
    },
  };
  const runtime = new AudioPipelineRuntime({
    captureWebContents: window.webContents,
    permissionGate: gate,
    utilityEntryPath: options.utilityEntry ?? utilityEntry,
    createLifecycleId: () => options.lifecycle,
    stopTimeoutMs: options.stopTimeoutMs ?? 2_000,
    createMessageChannel: () => new MessageChannelMain(),
    forkUtility: (entry) => {
      processHandle = utilityProcess.fork(entry, [], {
        env: {},
        serviceName: 'Production Audio Lifecycle Harness',
        stdio: 'ignore',
      });
      liveChildren.add(processHandle);
      processHandle.on('message', (message) => messages.push(structuredClone(message)));
      processHandle.once('exit', (code) => {
        liveChildren.delete(processHandle);
        resolveExit(code);
      });
      child = {
        on: (...args) => processHandle.on(...args),
        off: (...args) => processHandle.off(...args),
        postMessage: (message, transfer = []) => {
          if (options.holdAcks && message?.type === 'frame-ack') {
            heldAcks.push(structuredClone(message));
            return;
          }
          if (!(options.suppressStop && message?.type === 'stop')) {
            processHandle.postMessage(message, transfer);
          }
        },
        kill: () => {
          forcedKills += 1;
          return processHandle.kill();
        },
      };
      return child;
    },
    onFailure: (message) => {
      if (!options.allowFailure) fail(new Error(message));
    },
    onFrame: (frame) => frames.push(structuredClone(frame)),
  });
  return {
    runtime,
    gate,
    forcedKills: () => forcedKills,
    child: () => child,
    frames: () => frames,
    messages: () => messages,
    heldAcks: () => heldAcks,
    releaseAck: () => processHandle.postMessage(heldAcks.shift()),
    closeRemote: () => processHandle.kill(),
    exited: () => exited,
  };
}

app.whenReady().then(async () => {
  for (const entry of [utilityEntry, capturePreload, runtimeEntry]) {
    assert.equal(existsSync(entry), true, `missing production harness entry: ${entry}`);
  }
  timeout = setTimeout(() => fail(new Error('Electron production audio lifecycle timed out.')), 20_000);
  protocol.handle('copilot', () => new Response(
    '<!doctype html><title>production capture preload</title>',
    { headers: { 'content-type': 'text/html' } },
  ));
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: capturePreload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  const resourceProbe = createRendererResourceProbe(window.webContents);
  const preloadReady = waitForPreloadReady(window.webContents);
  await window.loadURL('copilot://app/index.html');
  await preloadReady;
  await resourceProbe.install();
  const setCapturePermission = (allowed) => {
    window.webContents.session.setPermissionCheckHandler((webContents, permission, _origin, details) =>
      allowed
        && webContents === window.webContents
        && permission === 'media'
        && details.mediaType === 'audio');
    window.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
      callback(allowed
        && webContents === window.webContents
        && permission === 'media'
        && details.mediaTypes?.length === 1
        && details.mediaTypes[0] === 'audio');
    });
  };
  setCapturePermission(true);

  const normal = createRuntime({ lifecycle: 'electron-normal-stop' });
  await normal.runtime.start({ microphone: false, systemAudio: false });
  assert.equal(normal.gate.lifecycle, 'electron-normal-stop');
  await normal.runtime.stop();
  assert.equal(normal.forcedKills(), 0, 'normal stop must not use forced kill');
  assert.equal(normal.runtime.isActive(), false);

  setCapturePermission(false);
  const failure = createRuntime({ lifecycle: 'electron-acquisition-failure', allowFailure: true });
  await assert.rejects(
    failure.runtime.start({ microphone: true, systemAudio: false }),
    /Audio capture failed\./,
  );
  await failure.runtime.stop();
  assert.equal(failure.runtime.isActive(), false);
  setCapturePermission(true);

  const crashed = createRuntime({
    lifecycle: 'electron-crash-cleanup',
    utilityEntry: crashEntry,
    allowFailure: true,
  });
  await assert.rejects(
    crashed.runtime.start({ microphone: false, systemAudio: false }),
    /exited before capture was ready/,
  );
  assert.equal(crashed.runtime.isActive(), false);

  const timeoutStop = createRuntime({
    lifecycle: 'electron-timeout-stop',
    suppressStop: true,
    stopTimeoutMs: 100,
  });
  await timeoutStop.runtime.start({ microphone: false, systemAudio: false });
  await timeoutStop.runtime.stop();
  assert.equal(timeoutStop.forcedKills(), 1, 'timeout path must force-kill exactly once');

  const afterRemoteClose = createRuntime({
    lifecycle: 'electron-after-remote-close',
    allowFailure: true,
    holdAcks: true,
  });
  await afterRemoteClose.runtime.start({ microphone: true, systemAudio: false });
  await waitFor(
    () => afterRemoteClose.frames().length === 4 && afterRemoteClose.heldAcks().length === 4,
    'four cloned PCM frames must reach the production runtime before ACK',
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  assert.ok(afterRemoteClose.frames().every(({ pcm }) => pcm instanceof Int16Array && pcm.length > 0));
  afterRemoteClose.releaseAck();
  await waitFor(
    () => afterRemoteClose.messages().some(({ type }) => type === 'frames-dropped'),
    'utility must report dropped frames after production ACK returns credit',
  );
  const dropped = afterRemoteClose.messages().find(({ type }) => type === 'frames-dropped');
  assert.ok(dropped.count > 0 && dropped.lastSequence >= 4);
  const resourcesBeforeClose = await resourceProbe.snapshot();
  assert.ok(resourcesBeforeClose.tracks.some((state) => state === 'live'));
  assert.ok(resourcesBeforeClose.contexts.some((state) => state !== 'closed'));

  const remoteCloseStarted = Date.now();
  assert.equal(afterRemoteClose.closeRemote(), true, 'remote utility process must close');
  await afterRemoteClose.exited();
  let resourcesAfterClose = await resourceProbe.snapshot();
  await waitFor(async () => {
    resourcesAfterClose = await resourceProbe.snapshot();
    return resourcesAfterClose.tracks.every((state) => state === 'ended')
      && resourcesAfterClose.contexts.every((state) => state === 'closed');
  }, 'remote utility close must release renderer resources immediately', 500);
  assert.ok(Date.now() - remoteCloseStarted < 500);
  assert.ok(resourcesAfterClose.stopCalls > 0 && resourcesAfterClose.closeCalls > 0);
  assert.equal(afterRemoteClose.runtime.isActive(), false);
  assert.equal(afterRemoteClose.gate.lifecycle, null);
  assert.equal(afterRemoteClose.forcedKills(), 0);

  resourceProbe.detach();
  window.destroy();
  window = undefined;
  clearTimeout(timeout);
  process.stdout.write('ELECTRON_AUDIO_OK production-preload synthetic-clone ack-drop remote-close-cleanup graceful-stop timeout crash\n');
  app.quit();
}).catch(fail);
