import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BrowserMediaCaptureHost } from '../../src/audio/browser-media-capture-host';
import { CaptureController } from '../../src/audio/capture-controller';
import { installElectronLoopbackHandler } from '../../src/audio/electron-loopback-handler';
import { createAudioFrame } from '../../src/audio/audio-frame';
import { resamplePcm16Mono } from '../../src/audio/resampler';
import { VadDetector } from '../../src/audio/vad';

function pcm(values: number[]): Int16Array {
  return Int16Array.from(values);
}

async function nextValue<T>(iterator: AsyncIterator<T>): Promise<T> {
  const result = await iterator.next();
  if (result.done) {
    throw new Error('Expected another value.');
  }
  return result.value;
}

describe('audio pipeline', () => {
  it('orders overlapping source timestamps deterministically and assigns monotonic sequences', async () => {
    const controller = new CaptureController();
    controller.start({ targetSampleRate: 24_000, maxBufferedFrames: 8, jitterWindowMs: 20 });
    const frames = controller.frames()[Symbol.asyncIterator]();

    controller.accept({ source: 'system', capturedAt: 120, sampleRate: 24_000, channels: 1, pcm: pcm([3]) });
    controller.accept({ source: 'microphone', capturedAt: 100, sampleRate: 24_000, channels: 1, pcm: pcm([1]) });
    controller.accept({ source: 'system', capturedAt: 100, sampleRate: 24_000, channels: 1, pcm: pcm([2]) });
    controller.sourceLost('microphone');

    const observed = await Promise.all([nextValue(frames), nextValue(frames), nextValue(frames)]);
    expect(observed.map(({ source, capturedAt, sequence }) => ({ source, capturedAt, sequence }))).toEqual([
      { source: 'microphone', capturedAt: 100, sequence: 0 },
      { source: 'system', capturedAt: 100, sequence: 1 },
      { source: 'system', capturedAt: 120, sequence: 2 },
    ]);
  });

  it('resamples interleaved 48 kHz stereo PCM to 24 kHz mono', () => {
    const input = pcm([
      0, 2_000,
      2_000, 4_000,
      4_000, 6_000,
      6_000, 8_000,
    ]);

    expect([...resamplePcm16Mono(input, 48_000, 2, 24_000)]).toEqual([1_000, 5_000]);
  });

  it('bounds buffered audio and zeroes the frame dropped to preserve latency', () => {
    const controller = new CaptureController();
    controller.start({ targetSampleRate: 24_000, maxBufferedFrames: 2, jitterWindowMs: 1_000 });
    const oldest = pcm([111, 222]);

    controller.accept({ source: 'microphone', capturedAt: 0, sampleRate: 24_000, channels: 1, pcm: oldest });
    controller.accept({ source: 'microphone', capturedAt: 10, sampleRate: 24_000, channels: 1, pcm: pcm([333]) });
    controller.accept({ source: 'microphone', capturedAt: 20, sampleRate: 24_000, channels: 1, pcm: pcm([444]) });

    expect(controller.status()).toMatchObject({ bufferedFrames: 2, droppedFrames: 1 });
    expect([...oldest]).toEqual([0, 0]);
  });

  it('bounds a slow consumer queue and zeros queued frames on stop', () => {
    const controller = new CaptureController();
    controller.start({ targetSampleRate: 24_000, maxBufferedFrames: 2, jitterWindowMs: 0 });
    controller.frames();
    const first = pcm([111]);
    const second = pcm([222]);
    const third = pcm([333]);

    controller.accept({ source: 'system', capturedAt: 0, sampleRate: 24_000, channels: 1, pcm: first });
    controller.accept({ source: 'system', capturedAt: 10, sampleRate: 24_000, channels: 1, pcm: second });
    controller.accept({ source: 'system', capturedAt: 20, sampleRate: 24_000, channels: 1, pcm: third });

    expect([...first]).toEqual([0]);
    expect(controller.status()).toMatchObject({ droppedFrames: 1 });

    controller.stop();
    expect([...second]).toEqual([0]);
    expect([...third]).toEqual([0]);
  });

  it('zeros an emitted frame immediately when no consumer owns it', () => {
    const controller = new CaptureController();
    controller.start({ targetSampleRate: 24_000, maxBufferedFrames: 2, jitterWindowMs: 0 });
    const unconsumed = pcm([777]);

    controller.accept({ source: 'system', capturedAt: 0, sampleRate: 24_000, channels: 1, pcm: unconsumed });

    expect([...unconsumed]).toEqual([0]);
    expect(controller.status()).toMatchObject({ droppedFrames: 1 });
  });

  it('reports source loss without closing the surviving source', async () => {
    const controller = new CaptureController();
    controller.start({ targetSampleRate: 24_000, maxBufferedFrames: 4, jitterWindowMs: 0 });
    const events = controller.events()[Symbol.asyncIterator]();

    controller.sourceLost('system');

    await expect(nextValue(events)).resolves.toEqual({ type: 'source-lost', source: 'system' });
    expect(controller.status()).toMatchObject({ active: true, lostSources: ['system'] });
  });

  it('keeps raw audio memory-only by default and zeros retained bytes on stop', async () => {
    const controller = new CaptureController();
    controller.start({ targetSampleRate: 24_000, maxBufferedFrames: 4, jitterWindowMs: 1_000 });
    const retained = pcm([9, 8, 7]);
    const frames = controller.frames()[Symbol.asyncIterator]();

    controller.accept({ source: 'microphone', capturedAt: 0, sampleRate: 24_000, channels: 1, pcm: retained });
    expect(controller.status()).toMatchObject({ memoryOnly: true, bufferedFrames: 1 });

    controller.stop();

    expect([...retained]).toEqual([0, 0, 0]);
    await expect(frames.next()).resolves.toEqual({ done: true, value: undefined });
    expect(controller.status()).toMatchObject({ active: false, bufferedFrames: 0 });
  });

  it('detects one question across a short pause in the deterministic PCM fixture', () => {
    const fixturePath = fileURLToPath(new URL('../fixtures/audio/question-24k-mono.pcm', import.meta.url));
    const bytes = readFileSync(fixturePath);
    const fixture = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const detector = new VadDetector({ threshold: 1_000, speechFrames: 2, silenceFrames: 6 });
    const events = [];
    const frameSamples = 480;

    for (let offset = 0; offset < fixture.length; offset += frameSamples) {
      events.push(...detector.accept(createAudioFrame({
        source: 'microphone',
        sequence: offset / frameSamples,
        capturedAt: offset / 24,
        sampleRate: 24_000,
        channels: 1,
        pcm: fixture.slice(offset, offset + frameSamples),
      })));
    }

    expect(events.map(({ type }) => type)).toEqual(['speech-start', 'speech-end']);
    expect(events[0]).toMatchObject({ source: 'microphone', capturedAt: 100 });
    expect(events[1]).toMatchObject({ source: 'microphone' });
  });

  it('acquires Electron system loopback and microphone streams in the renderer capture host', async () => {
    const systemVideoTrack = { stopCalls: 0, stop() { this.stopCalls += 1; } };
    const systemAudioTrack = { stopCalls: 0, stop() { this.stopCalls += 1; } };
    const microphoneTrack = { stopCalls: 0, stop() { this.stopCalls += 1; } };
    const systemStream = {
      getAudioTracks: () => [systemAudioTrack],
      getVideoTracks: () => [systemVideoTrack],
      getTracks: () => [systemAudioTrack, systemVideoTrack],
    } as unknown as MediaStream;
    const microphoneStream = {
      getAudioTracks: () => [microphoneTrack],
      getVideoTracks: () => [],
      getTracks: () => [microphoneTrack],
    } as unknown as MediaStream;
    const requested: MediaStreamConstraints[] = [];
    const displayRequested: DisplayMediaStreamOptions[] = [];
    const mediaDevices = {
      getDisplayMedia: async (constraints: DisplayMediaStreamOptions) => {
        displayRequested.push(constraints);
        return systemStream;
      },
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        requested.push(constraints);
        return microphoneStream;
      },
    } as Pick<MediaDevices, 'getDisplayMedia' | 'getUserMedia'>;
    const connectedSources: AudioSource[] = [];
    const host = new BrowserMediaCaptureHost({
      mediaDevices,
      connectStream: (_stream, source) => {
        connectedSources.push(source);
        return { release() {} };
      },
      now: () => 42,
    });

    await host.start({ microphone: true, systemAudio: true }, () => undefined, () => undefined);

    expect(displayRequested).toEqual([{ audio: true, video: true }]);
    expect(requested).toEqual([{ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }]);
    expect(systemVideoTrack.stopCalls).toBe(1);
    expect(connectedSources).toEqual(['system', 'microphone']);

    host.stop();
    expect(systemAudioTrack.stopCalls).toBe(1);
    expect(microphoneTrack.stopCalls).toBe(1);
  });

  it('releases system capture when microphone acquisition fails partway through start', async () => {
    const systemTrack = { stopCalls: 0, stop() { this.stopCalls += 1; } };
    const systemStream = {
      getAudioTracks: () => [systemTrack],
      getVideoTracks: () => [],
      getTracks: () => [systemTrack],
    } as unknown as MediaStream;
    let releases = 0;
    const host = new BrowserMediaCaptureHost({
      mediaDevices: {
        getDisplayMedia: async () => systemStream,
        getUserMedia: async () => { throw new Error('microphone unavailable'); },
      } as Pick<MediaDevices, 'getDisplayMedia' | 'getUserMedia'>,
      connectStream: () => ({ release: () => { releases += 1; } }),
    });

    await expect(host.start({ microphone: true, systemAudio: true }, () => undefined, () => undefined))
      .rejects.toThrow('microphone unavailable');
    expect(releases).toBe(1);
    expect(systemTrack.stopCalls).toBe(1);
  });

  it('grants Windows loopback only to the packaged local capture host', async () => {
    let handler: ((request: {
      securityOrigin: string;
      audioRequested: boolean;
      videoRequested: boolean;
    }, callback: (streams: unknown) => void) => void) | undefined;
    let permissionCheck: ((
      webContents: unknown,
      permission: string,
      requestingOrigin: string,
      details: { securityOrigin?: string; mediaType?: string },
    ) => boolean) | undefined;
    let permissionRequest: ((
      webContents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
      details: { securityOrigin?: string; mediaTypes?: string[] },
    ) => void) | undefined;
    const captureSession = {
      setDisplayMediaRequestHandler: (nextHandler: typeof handler) => {
        handler = nextHandler;
      },
      setPermissionCheckHandler: (nextHandler: typeof permissionCheck) => {
        permissionCheck = nextHandler;
      },
      setPermissionRequestHandler: (nextHandler: typeof permissionRequest) => {
        permissionRequest = nextHandler;
      },
    };
    const screen = { id: 'screen:0:0', name: 'Entire Screen' };
    installElectronLoopbackHandler(captureSession as never, {
      getSources: async () => [screen],
    } as never);
    const allowed: unknown[] = [];
    const denied: unknown[] = [];

    handler?.(
      { securityOrigin: 'copilot://app/', audioRequested: true, videoRequested: true },
      (streams) => allowed.push(streams),
    );
    handler?.(
      { securityOrigin: 'https://example.test', audioRequested: true, videoRequested: true },
      (streams) => denied.push(streams),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(allowed).toEqual([{ audio: 'loopback', video: screen }]);
    expect(denied).toEqual([{}]);
    expect(permissionCheck?.(null, 'media', 'copilot://app/', {
      securityOrigin: 'copilot://app/',
      mediaType: 'audio',
    })).toBe(true);
    expect(permissionCheck?.(null, 'media', 'https://example.test', {
      securityOrigin: 'https://example.test',
      mediaType: 'audio',
    })).toBe(false);
    const microphonePermission: boolean[] = [];
    permissionRequest?.(null, 'media', (granted) => microphonePermission.push(granted), {
      securityOrigin: 'copilot://app/',
      mediaTypes: ['audio'],
    });
    expect(microphonePermission).toEqual([true]);
  });
});

type AudioSource = 'microphone' | 'system';
