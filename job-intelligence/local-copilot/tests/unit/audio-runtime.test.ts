import { EventEmitter } from 'node:events';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AudioCaptureRuntime, type CaptureHost } from '../../src/audio/audio-capture-runtime';
import { installCapturePreload } from '../../src/audio/install-capture-preload';
import { CapturePermissionGate } from '../../src/audio/electron-loopback-handler';
import {
  AudioPipelineRuntime,
  resolveAudioUtilityEntry,
  type AudioPipelinePort,
  type UtilityChild,
} from '../../src/main/audio/audio-pipeline-runtime';

class TestPort extends EventEmitter implements AudioPipelinePort {
  public readonly sent: unknown[] = [];
  public closeCalls = 0;
  public startCalls = 0;

  public postMessage(message: unknown): void {
    this.sent.push(structuredClone(message));
  }

  public start(): void {
    this.startCalls += 1;
  }

  public close(): void {
    this.closeCalls += 1;
    this.emit('close');
  }

  public receive(data: unknown): void {
    this.emit('message', { data: structuredClone(data), ports: [] });
  }
}

class TestUtilityChild extends EventEmitter implements UtilityChild {
  public readonly sent: Array<{ message: unknown; transfer: AudioPipelinePort[] }> = [];
  public killCalls = 0;

  public postMessage(message: unknown, transfer: AudioPipelinePort[] = []): void {
    this.sent.push({ message: structuredClone(message), transfer });
  }

  public kill(): boolean {
    this.killCalls += 1;
    return true;
  }

  public receive(message: unknown): void {
    this.emit('message', structuredClone(message));
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('audio runtime wiring', () => {
  it('resolves co-located development and packaged utility entries explicitly', () => {
    expect(resolveAudioUtilityEntry({
      isPackaged: false,
      buildDirectory: 'C:\\repo\\.vite\\build',
      appPath: 'C:\\repo',
    })).toBe(join('C:\\repo\\.vite\\build', 'audio-utility.js'));
    expect(resolveAudioUtilityEntry({
      isPackaged: true,
      buildDirectory: 'C:\\ignored-dev-build',
      appPath: 'C:\\Program Files\\Copilot\\resources\\app.asar',
    })).toBe(join('C:\\Program Files\\Copilot\\resources\\app.asar', '.vite', 'build', 'audio-utility.js'));
  });

  it('spawns the utility, transfers narrow ports, and revokes capture on utility exit', async () => {
    const child = new TestUtilityChild();
    const capturePorts = [new TestPort(), new TestPort()] as const;
    const postedToCapture: Array<{ channel: string; message: unknown; transfer: AudioPipelinePort[] }> = [];
    const mainFrame = {};
    const captureWebContents = {
      id: 9,
      mainFrame,
      postMessage(channel: string, message: unknown, transfer: AudioPipelinePort[]) {
        postedToCapture.push({ channel, message, transfer });
      },
    };
    const gate = new CapturePermissionGate(captureWebContents as never);
    const failures: string[] = [];
    const runtime = new AudioPipelineRuntime({
      captureWebContents: captureWebContents as never,
      permissionGate: gate,
      utilityEntryPath: 'C:\\app\\.vite\\build\\audio-utility.js',
      forkUtility: () => child,
      createMessageChannel: () => ({ port1: capturePorts[0], port2: capturePorts[1] }),
      createLifecycleId: () => 'capture-1',
      onFailure: (message) => failures.push(message),
    });

    await runtime.start({ microphone: true, systemAudio: false });

    expect(child.sent[0]).toEqual({ message: { type: 'connect', lifecycle: 'capture-1' }, transfer: [capturePorts[1]] });
    expect(child.sent[1]).toMatchObject({
      message: {
        type: 'start',
        config: {
          maxInFlightFrames: 4,
          capture: {
            lifecycle: 'capture-1',
            microphone: true,
            systemAudio: false,
            initialCredits: 32,
          },
        },
      },
      transfer: [],
    });
    expect(postedToCapture).toEqual([{
      channel: 'audio:capture-port',
      message: { type: 'audio-capture-port', lifecycle: 'capture-1' },
      transfer: [capturePorts[0]],
    }]);
    expect(gate.allowsDisplay(mainFrame, 'copilot://app/')).toBe(true);

    child.emit('exit', 7);

    expect(gate.allowsDisplay(mainFrame, 'copilot://app/')).toBe(false);
    expect(failures).toEqual(['Audio utility exited with code 7.']);
    expect(runtime.isActive()).toBe(false);
  });

  it('acks processed utility frames received across the real child control boundary', async () => {
    const child = new TestUtilityChild();
    const capturePorts = [new TestPort(), new TestPort()] as const;
    const captureWebContents = { id: 9, mainFrame: {}, postMessage() {} };
    const observedPcm: number[][] = [];
    const runtime = new AudioPipelineRuntime({
      captureWebContents: captureWebContents as never,
      permissionGate: new CapturePermissionGate(captureWebContents as never),
      utilityEntryPath: 'audio-utility.js',
      forkUtility: () => child,
      createMessageChannel: () => ({ port1: capturePorts[0], port2: capturePorts[1] }),
      createLifecycleId: () => 'capture-2',
      onFrame: (frame) => observedPcm.push([...frame.pcm]),
    });
    await runtime.start({ microphone: true, systemAudio: true });
    const utilityPcm = Int16Array.from([3, 4]);
    child.receive({
      type: 'frame',
      frame: {
        source: 'microphone', sequence: 5, capturedAt: 1, sampleRate: 24_000, channels: 1, pcm: utilityPcm,
      },
    });

    expect(observedPcm).toEqual([[3, 4]]);
    expect([...utilityPcm]).toEqual([3, 4]);
    expect(child.sent.at(-1)).toEqual({ message: { type: 'frame-ack', sequence: 5 }, transfer: [] });
    runtime.stop();
  });

  it('revokes capture and kills the utility when transferred-port setup fails', async () => {
    const child = new TestUtilityChild();
    const capturePorts = [new TestPort(), new TestPort()] as const;
    const captureWebContents = {
      id: 9,
      mainFrame: {},
      postMessage() { throw new Error('renderer exited'); },
    };
    const gate = new CapturePermissionGate(captureWebContents as never);
    const runtime = new AudioPipelineRuntime({
      captureWebContents: captureWebContents as never,
      permissionGate: gate,
      utilityEntryPath: 'audio-utility.js',
      forkUtility: () => child,
      createMessageChannel: () => ({ port1: capturePorts[0], port2: capturePorts[1] }),
      createLifecycleId: () => 'capture-setup-failure',
    });

    await expect(runtime.start({ microphone: true, systemAudio: false })).rejects.toThrow('renderer exited');

    expect(child.killCalls).toBe(1);
    expect(runtime.isActive()).toBe(false);
    expect(gate.allowsDisplay(captureWebContents.mainFrame, 'copilot://app/')).toBe(false);
  });

  it('schema-rejects malformed utility output and performs fatal cleanup', async () => {
    const child = new TestUtilityChild();
    const capturePorts = [new TestPort(), new TestPort()] as const;
    const captureWebContents = { id: 9, mainFrame: {}, postMessage() {} };
    const failures: string[] = [];
    const runtime = new AudioPipelineRuntime({
      captureWebContents: captureWebContents as never,
      permissionGate: new CapturePermissionGate(captureWebContents as never),
      utilityEntryPath: 'audio-utility.js',
      forkUtility: () => child,
      createMessageChannel: () => ({ port1: capturePorts[0], port2: capturePorts[1] }),
      createLifecycleId: () => 'capture-invalid-output',
      onFailure: (message) => failures.push(message),
    });
    await runtime.start({ microphone: true, systemAudio: false });

    expect(() => child.receive({
      type: 'frame',
      frame: {
        source: 'microphone', sequence: 0, capturedAt: 0, sampleRate: 24_000, channels: 1, pcm: 'invalid',
      },
    })).not.toThrow();

    expect(failures).toEqual(['Audio utility sent an invalid message.']);
    expect(child.killCalls).toBe(1);
    expect(runtime.isActive()).toBe(false);
  });

  it('kills and releases the child after a utility-initiated capture stop', async () => {
    const child = new TestUtilityChild();
    const capturePorts = [new TestPort(), new TestPort()] as const;
    const captureWebContents = { id: 9, mainFrame: {}, postMessage() {} };
    const runtime = new AudioPipelineRuntime({
      captureWebContents: captureWebContents as never,
      permissionGate: new CapturePermissionGate(captureWebContents as never),
      utilityEntryPath: 'audio-utility.js',
      forkUtility: () => child,
      createMessageChannel: () => ({ port1: capturePorts[0], port2: capturePorts[1] }),
      createLifecycleId: () => 'capture-utility-stop',
    });
    await runtime.start({ microphone: true, systemAudio: false });

    child.receive({ type: 'stopped' });

    expect(child.killCalls).toBe(1);
    expect(runtime.isActive()).toBe(false);
  });

  it('instantiates the capture host protocol with bounded input credits and zeroes sent PCM', async () => {
    let onChunk: ((chunk: Parameters<Parameters<CaptureHost['start']>[1]>[0]) => void) | undefined;
    let onSourceLost: ((source: 'microphone' | 'system') => void) | undefined;
    const starts: unknown[] = [];
    let stops = 0;
    const host: CaptureHost = {
      async start(config, nextChunk, nextSourceLost) {
        starts.push(config);
        onChunk = nextChunk;
        onSourceLost = nextSourceLost;
      },
      stop() { stops += 1; },
    };
    const port = new TestPort();
    const runtime = new AudioCaptureRuntime(host);
    runtime.connect(port, 'capture-3');
    port.receive({
      type: 'start-capture',
      lifecycle: 'capture-3',
      config: { microphone: true, systemAudio: true },
      credits: 1,
    });
    await tick();

    expect(starts).toEqual([{ microphone: true, systemAudio: true }]);
    const sent = Int16Array.from([10, 20]);
    onChunk?.({ source: 'system', capturedAt: 1, sampleRate: 24_000, channels: 1, pcm: sent });
    const dropped = Int16Array.from([30, 40]);
    onChunk?.({ source: 'system', capturedAt: 2, sampleRate: 24_000, channels: 1, pcm: dropped });

    expect([...sent]).toEqual([0, 0]);
    expect([...dropped]).toEqual([0, 0]);
    expect(port.sent.filter((message) => (message as { type?: string }).type === 'audio-chunk')).toHaveLength(1);
    onSourceLost?.('system');
    expect(port.sent.at(-1)).toEqual({ type: 'source-lost', lifecycle: 'capture-3', source: 'system' });

    port.receive({ type: 'stop-capture', lifecycle: 'capture-3' });
    expect(stops).toBe(2);
    expect(port.closeCalls).toBe(1);
  });

  it('attaches only one validated transferred port inside the designated capture preload', () => {
    let attach: ((event: { ports: TestPort[] }, message: unknown) => void) | undefined;
    const ipc = {
      on(channel: string, listener: typeof attach) {
        if (channel === 'audio:capture-port') attach = listener;
      },
    };
    const host: CaptureHost = { start: async () => undefined, stop() {} };
    const port = new TestPort();

    installCapturePreload(ipc, host);
    attach?.({ ports: [port] }, { type: 'audio-capture-port', lifecycle: 'capture-preload-1' });

    expect(port.startCalls).toBe(1);
  });
});
