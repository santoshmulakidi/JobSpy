import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import {
  startAudioUtility,
  startAudioUtilityParentPort,
  type AudioUtilityMessage,
} from '../../src/audio/utility-entry';
import forgeConfig from '../../forge.config';
import { snapshotRecordingFiles } from '../support/no-recording-files';

class TestParentPort extends EventEmitter {
  public readonly sent: Array<AudioUtilityMessage | Record<string, unknown>> = [];

  public postMessage(message: AudioUtilityMessage | Record<string, unknown>): void {
    this.sent.push(structuredClone(message));
  }

  public receive(data: unknown, ports: TestParentPort[] = []): void {
    this.emit('message', { data, ports });
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for utility output.');
}

describe('audio utility boundary', () => {
  it('packages the utility entry as an isolated Electron build target', () => {
    const vitePlugin = forgeConfig.plugins?.find((plugin) =>
      typeof plugin === 'object' && plugin !== null && plugin.name === '@electron-forge/plugin-vite');

    expect(vitePlugin).toMatchObject({
      config: {
        build: expect.arrayContaining([
          { entry: 'src/audio/utility-entry.ts', config: 'vite.utility.config.ts' },
          { entry: 'src/audio/capture-preload.ts', config: 'vite.capture-preload.config.ts' },
          { entry: 'src/main/audio/audio-pipeline-runtime.ts', config: 'vite.audio-runtime.config.ts' },
        ]),
      },
    });
  });

  it('processes transferred capture chunks without writing a recording', async () => {
    const recordingsBefore = snapshotRecordingFiles(process.cwd());
    const port = new TestParentPort();
    const utility = startAudioUtility(port);
    const transferred = Int16Array.from([0, 1_000, 2_000, 3_000]);

    port.receive({
      type: 'start',
      config: {
        targetSampleRate: 24_000,
        maxBufferedFrames: 4,
        jitterWindowMs: 0,
        maxInFlightFrames: 2,
        vad: { threshold: 1_000, speechFrames: 2, silenceFrames: 2 },
      },
    });
    port.receive({
      type: 'audio-chunk',
      chunk: { source: 'system', capturedAt: 50, sampleRate: 48_000, channels: 1, pcm: transferred },
    });
    await waitFor(() => port.sent.some(({ type }) => type === 'frame'));

    expect(port.sent).toContainEqual({ type: 'ready' });
    expect(port.sent).toContainEqual({
      type: 'frame',
      frame: expect.objectContaining({
        source: 'system',
        sequence: 0,
        capturedAt: 50,
        sampleRate: 24_000,
        channels: 1,
        pcm: Int16Array.from([0, 2_000]),
      }),
    });

    port.receive({ type: 'source-lost', source: 'system' });
    await waitFor(() => port.sent.some(({ type }) => type === 'source-lost'));
    port.receive({ type: 'stop' });
    await utility.closed;

    expect([...transferred]).toEqual([0, 0, 0, 0]);
    expect(port.sent.at(-1)).toEqual({ type: 'stopped' });
    expect(snapshotRecordingFiles(process.cwd())).toEqual(recordingsBefore);
  });

  it('bounds unacknowledged frames and reports deterministic zeroed drops after credit returns', async () => {
    const port = new TestParentPort();
    const utility = startAudioUtility(port);
    port.receive({
      type: 'start',
      config: {
        targetSampleRate: 24_000,
        maxBufferedFrames: 4,
        jitterWindowMs: 0,
        maxInFlightFrames: 1,
        vad: { threshold: 1_000, speechFrames: 2, silenceFrames: 2 },
      },
    });
    const first = Int16Array.from([100]);
    const dropped = Int16Array.from([200]);
    port.receive({
      type: 'audio-chunk',
      chunk: { source: 'system', capturedAt: 0, sampleRate: 24_000, channels: 1, pcm: first },
    });
    port.receive({
      type: 'audio-chunk',
      chunk: { source: 'system', capturedAt: 10, sampleRate: 24_000, channels: 1, pcm: dropped },
    });
    await waitFor(() => port.sent.filter(({ type }) => type === 'frame').length === 1);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(port.sent.filter(({ type }) => type === 'frame')).toHaveLength(1);
    expect([...first]).toEqual([0]);
    expect([...dropped]).toEqual([0]);

    port.receive({ type: 'frame-ack', sequence: 0 });
    await waitFor(() => port.sent.some(({ type }) => type === 'frames-dropped'));
    expect(port.sent).toContainEqual({ type: 'frames-dropped', count: 1, lastSequence: 1 });

    const afterAck = Int16Array.from([300]);
    port.receive({
      type: 'audio-chunk',
      chunk: { source: 'system', capturedAt: 20, sampleRate: 24_000, channels: 1, pcm: afterAck },
    });
    await waitFor(() => port.sent.filter(({ type }) => type === 'frame').length === 2);
    expect(port.sent.filter(({ type }) => type === 'frame').at(-1)).toMatchObject({
      frame: { sequence: 2, capturedAt: 20 },
    });

    port.receive({ type: 'stop' });
    await utility.closed;
  });

  it('runs VAD in the utility and emits normalized speech boundaries', async () => {
    const port = new TestParentPort();
    const utility = startAudioUtility(port);
    port.receive({
      type: 'start',
      config: {
        targetSampleRate: 24_000,
        maxBufferedFrames: 4,
        jitterWindowMs: 0,
        maxInFlightFrames: 4,
        vad: { threshold: 1_000, speechFrames: 1, silenceFrames: 1 },
      },
    });
    port.receive({
      type: 'audio-chunk',
      chunk: {
        source: 'microphone', capturedAt: 100, sampleRate: 24_000, channels: 1,
        pcm: new Int16Array(480).fill(4_000),
      },
    });
    port.receive({
      type: 'audio-chunk',
      chunk: {
        source: 'microphone', capturedAt: 120, sampleRate: 24_000, channels: 1,
        pcm: new Int16Array(480),
      },
    });

    await waitFor(() => port.sent.some(({ type }) => type === 'speech-end'));
    expect(port.sent).toContainEqual({ type: 'speech-start', source: 'microphone', capturedAt: 100 });
    expect(port.sent).toContainEqual({ type: 'speech-end', source: 'microphone', capturedAt: 120 });

    port.receive({ type: 'stop' });
    await utility.closed;
  });

  it('schema-rejects malformed chunks, zeros candidate PCM, and closes capture fatally', async () => {
    const port = new TestParentPort();
    const utility = startAudioUtility(port);
    port.receive({
      type: 'start',
      config: {
        targetSampleRate: 24_000,
        maxBufferedFrames: 4,
        jitterWindowMs: 0,
        maxInFlightFrames: 2,
        vad: { threshold: 1_000, speechFrames: 1, silenceFrames: 1 },
      },
    });
    const invalid = Int16Array.from([9, 8, 7]);

    port.receive({
      type: 'audio-chunk',
      chunk: {
        source: 'microphone', capturedAt: Number.NaN, sampleRate: 24_000, channels: 1, pcm: invalid,
      },
    });
    await utility.closed;

    expect([...invalid]).toEqual([0, 0, 0]);
    expect(port.sent).toContainEqual({ type: 'error', fatal: true, message: 'Invalid audio utility command.' });
    expect(port.sent.at(-1)).toEqual({ type: 'stopped' });
  });

  it('attaches a transferred capture port while keeping processed output on the parent control port', async () => {
    const parent = new TestParentPort();
    const capture = new TestParentPort();
    const connected = startAudioUtilityParentPort(parent);
    parent.receive({ type: 'connect', lifecycle: 'capture-real' }, [capture]);
    const utility = await connected;
    parent.receive({
      type: 'start',
      config: {
        targetSampleRate: 24_000,
        maxBufferedFrames: 4,
        jitterWindowMs: 0,
        maxInFlightFrames: 1,
        vad: { threshold: 1_000, speechFrames: 1, silenceFrames: 1 },
        capture: {
          lifecycle: 'capture-real', microphone: true, systemAudio: false, initialCredits: 2,
        },
      },
    });
    await waitFor(() => capture.sent.some(({ type }) => type === 'start-capture'));
    expect(capture.sent).toContainEqual({
      type: 'start-capture',
      lifecycle: 'capture-real',
      config: { microphone: true, systemAudio: false },
      credits: 2,
    });
    const raw = Int16Array.from([1, 2, 3, 4]);
    capture.receive({
      type: 'audio-chunk',
      lifecycle: 'capture-real',
      chunk: { source: 'microphone', capturedAt: 10, sampleRate: 48_000, channels: 1, pcm: raw },
    });

    await waitFor(() => parent.sent.some(({ type }) => type === 'frame'));
    expect(parent.sent).toContainEqual({
      type: 'frame',
      frame: expect.objectContaining({ pcm: Int16Array.from([1, 3]), sampleRate: 24_000 }),
    });
    expect(capture.sent).toContainEqual({ type: 'capture-credit', lifecycle: 'capture-real', count: 1 });
    expect([...raw]).toEqual([0, 0, 0, 0]);

    parent.receive({ type: 'stop' });
    await waitFor(() => capture.sent.some(({ type }) => type === 'stop-capture'));
    capture.receive({ type: 'capture-stopped', lifecycle: 'capture-real' });
    await utility.closed;
    expect(capture.sent.at(-1)).toEqual({ type: 'stop-capture', lifecycle: 'capture-real' });
  });

  it('forwards capture readiness and waits for renderer stopped acknowledgement before stopping', async () => {
    const parent = new TestParentPort();
    const capture = new TestParentPort();
    const connected = startAudioUtilityParentPort(parent);
    parent.receive({ type: 'connect', lifecycle: 'capture-handshake' }, [capture]);
    const utility = await connected;
    parent.receive({
      type: 'start',
      config: {
        targetSampleRate: 24_000,
        maxBufferedFrames: 4,
        jitterWindowMs: 0,
        maxInFlightFrames: 1,
        vad: { threshold: 1_000, speechFrames: 1, silenceFrames: 1 },
        capture: {
          lifecycle: 'capture-handshake', microphone: false, systemAudio: false, initialCredits: 1,
        },
      },
    });
    capture.receive({ type: 'capture-ready', lifecycle: 'capture-handshake' });
    await waitFor(() => parent.sent.some(({ type }) => type === 'capture-ready'));
    expect(parent.sent).toContainEqual({ type: 'capture-ready', lifecycle: 'capture-handshake' });

    parent.receive({ type: 'stop' });
    await waitFor(() => capture.sent.some(({ type }) => type === 'stop-capture'));
    expect(parent.sent).not.toContainEqual({ type: 'stopped' });

    capture.receive({ type: 'capture-stopped', lifecycle: 'capture-handshake' });
    await utility.closed;
    expect(parent.sent.at(-1)).toEqual({ type: 'stopped' });
  });

  it('forwards capture startup failure and completes teardown only after renderer acknowledgement', async () => {
    const parent = new TestParentPort();
    const capture = new TestParentPort();
    const connected = startAudioUtilityParentPort(parent);
    parent.receive({ type: 'connect', lifecycle: 'capture-failure' }, [capture]);
    const utility = await connected;
    parent.receive({
      type: 'start',
      config: {
        targetSampleRate: 24_000,
        maxBufferedFrames: 4,
        jitterWindowMs: 0,
        maxInFlightFrames: 1,
        vad: { threshold: 1_000, speechFrames: 1, silenceFrames: 1 },
        capture: {
          lifecycle: 'capture-failure', microphone: true, systemAudio: false, initialCredits: 1,
        },
      },
    });
    capture.receive({
      type: 'capture-error', lifecycle: 'capture-failure', message: 'Audio capture failed.',
    });
    await waitFor(() => parent.sent.some(({ type }) => type === 'capture-error'));
    expect(parent.sent).toContainEqual({
      type: 'capture-error', lifecycle: 'capture-failure', message: 'Audio capture failed.',
    });
    expect(parent.sent).not.toContainEqual({ type: 'stopped' });

    capture.receive({ type: 'capture-stopped', lifecycle: 'capture-failure' });
    await utility.closed;
    expect(parent.sent.at(-1)).toEqual({ type: 'stopped' });
  });
});
