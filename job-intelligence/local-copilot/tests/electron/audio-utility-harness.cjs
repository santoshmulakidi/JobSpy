const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { app, BrowserWindow, ipcMain, MessageChannelMain, utilityProcess } = require('electron');

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

function createRuntime(options = {}) {
  let forcedKills = 0;
  let child;
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
      const processHandle = utilityProcess.fork(entry, [], {
        env: {},
        serviceName: 'Production Audio Lifecycle Harness',
        stdio: 'ignore',
      });
      liveChildren.add(processHandle);
      processHandle.once('exit', () => liveChildren.delete(processHandle));
      child = {
        on: (...args) => processHandle.on(...args),
        off: (...args) => processHandle.off(...args),
        postMessage: (message, transfer = []) => {
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
  });
  return { runtime, gate, forcedKills: () => forcedKills, child: () => child };
}

app.whenReady().then(async () => {
  for (const entry of [utilityEntry, capturePreload, runtimeEntry]) {
    assert.equal(existsSync(entry), true, `missing production harness entry: ${entry}`);
  }
  timeout = setTimeout(() => fail(new Error('Electron production audio lifecycle timed out.')), 20_000);
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: capturePreload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  const preloadReady = waitForPreloadReady(window.webContents);
  await window.loadURL('data:text/html,<title>production capture preload</title>');
  await preloadReady;

  const normal = createRuntime({ lifecycle: 'electron-normal-stop' });
  await normal.runtime.start({ microphone: false, systemAudio: false });
  assert.equal(normal.gate.lifecycle, 'electron-normal-stop');
  await normal.runtime.stop();
  assert.equal(normal.forcedKills(), 0, 'normal stop must not use forced kill');
  assert.equal(normal.runtime.isActive(), false);

  const failure = createRuntime({ lifecycle: 'electron-acquisition-failure', allowFailure: true });
  await assert.rejects(
    failure.runtime.start({ microphone: true, systemAudio: false }),
    /Audio capture failed\./,
  );
  await failure.runtime.stop();
  assert.equal(failure.runtime.isActive(), false);

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

  const afterRemoteClose = createRuntime({ lifecycle: 'electron-after-remote-close' });
  await afterRemoteClose.runtime.start({ microphone: false, systemAudio: false });
  await afterRemoteClose.runtime.stop();
  assert.equal(afterRemoteClose.forcedKills(), 0);

  window.destroy();
  window = undefined;
  clearTimeout(timeout);
  process.stdout.write('ELECTRON_AUDIO_OK production-preload ready failure remote-close graceful-stop timeout crash\n');
  app.quit();
}).catch(fail);
