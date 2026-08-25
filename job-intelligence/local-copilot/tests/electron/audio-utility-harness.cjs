const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { app, BrowserWindow, ipcMain, MessageChannelMain, utilityProcess } = require('electron');

const workingRoot = resolve(__dirname, '..', '..');
const usePackagedEntry = process.argv.includes('packaged');
const utilityEntry = usePackagedEntry
  ? join(
      workingRoot,
      'out',
      'local-windows-ai-copilot-win32-x64',
      'resources',
      'app.asar',
      '.vite',
      'build',
      'audio-utility.js',
    )
  : join(workingRoot, '.vite', 'build', 'audio-utility.js');
const crashEntry = join(__dirname, 'audio-crash-fixture.cjs');
const preload = join(__dirname, 'audio-capture-fixture.cjs');
const userData = mkdtempSync(join(tmpdir(), 'copilot-audio-electron-'));
app.setPath('userData', userData);
app.disableHardwareAcceleration();

let timeout;
let window;
let child;

function fail(error) {
  clearTimeout(timeout);
  try { child?.kill(); } catch {}
  try { window?.destroy(); } catch {}
  process.stderr.write(`${error?.stack ?? error}\n`);
  app.exit(1);
}

function waitForExit(processHandle) {
  return new Promise((resolveExit) => processHandle.once('exit', (code) => resolveExit(code)));
}

app.whenReady().then(async () => {
  assert.equal(existsSync(utilityEntry), true, `missing built utility: ${utilityEntry}`);
  timeout = setTimeout(() => fail(new Error(`Electron audio integration timed out: ${JSON.stringify({ frame, dropped, detachments })}`)), 15_000);
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  await window.loadURL('data:text/html,<title>capture fixture</title>');

  const detachments = [];
  ipcMain.on('audio-fixture-detached', (_event, detached) => detachments.push(detached));
  ipcMain.once('audio-fixture-error', (_event, message) => fail(new Error(message)));

  child = utilityProcess.fork(utilityEntry, [], {
    env: {},
    serviceName: 'Audio Integration Fixture',
    stdio: 'ignore',
  });
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once('spawn', resolveSpawn);
    child.once('exit', (code) => rejectSpawn(new Error(`utility exited before spawn handshake: ${code}`)));
  });

  const { port1, port2 } = new MessageChannelMain();
  const lifecycle = 'electron-audio-fixture';
  window.webContents.postMessage(
    'audio:capture-port',
    { type: 'audio-capture-port', lifecycle },
    [port1],
  );
  child.postMessage({ type: 'connect', lifecycle }, [port2]);

  let frame;
  let dropped;
  let stopped = false;
  child.on('message', (message) => {
    if (message?.type === 'frame' && !frame) {
      frame = message.frame;
      setTimeout(() => child.postMessage({ type: 'frame-ack', sequence: frame.sequence }), 75);
    } else if (message?.type === 'frames-dropped') {
      dropped = message;
      child.postMessage({ type: 'stop' });
    } else if (message?.type === 'stopped') {
      stopped = true;
      child.kill();
    } else if (message?.type === 'error') {
      fail(new Error(message.message));
    }
  });
  child.postMessage({
    type: 'start',
    config: {
      targetSampleRate: 24_000,
      maxBufferedFrames: 4,
      jitterWindowMs: 0,
      maxInFlightFrames: 1,
      vad: { threshold: 1_000, speechFrames: 1, silenceFrames: 1 },
      capture: { lifecycle, microphone: true, systemAudio: false, initialCredits: 2 },
    },
  });

  const exitCode = await waitForExit(child);
  assert.equal(exitCode, 0);
  assert.equal(stopped, true);
  assert.ok(frame);
  assert.ok(frame.pcm instanceof Int16Array);
  assert.deepEqual([...frame.pcm], [1, 3]);
  assert.deepEqual(dropped, { type: 'frames-dropped', count: 1, lastSequence: 1 });
  assert.deepEqual(detachments, [true, true]);
  window.destroy();
  window = undefined;

  const crashed = utilityProcess.fork(crashEntry, [], { env: {}, stdio: 'ignore' });
  await new Promise((resolveSpawn) => crashed.once('spawn', resolveSpawn));
  const crashCode = await waitForExit(crashed);
  assert.notEqual(crashCode, 0);

  clearTimeout(timeout);
  rmSync(userData, { recursive: true, force: true });
  process.stdout.write('ELECTRON_AUDIO_OK spawn transfer clone backpressure exit crash\n');
  app.quit();
}).catch(fail);
