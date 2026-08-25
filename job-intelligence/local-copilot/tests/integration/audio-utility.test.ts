import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { startAudioUtility, type AudioUtilityMessage } from '../../src/audio/utility-entry';
import forgeConfig from '../../forge.config';

class TestParentPort extends EventEmitter {
  public readonly sent: AudioUtilityMessage[] = [];

  public postMessage(message: AudioUtilityMessage): void {
    this.sent.push(message);
  }

  public receive(data: unknown): void {
    this.emit('message', { data });
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
        ]),
      },
    });
  });

  it('processes transferred capture chunks without writing a recording', async () => {
    const port = new TestParentPort();
    const utility = startAudioUtility(port);
    const transferred = Int16Array.from([0, 1_000, 2_000, 3_000]);

    port.receive({
      type: 'start',
      config: { targetSampleRate: 24_000, maxBufferedFrames: 4, jitterWindowMs: 0 },
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
  });
});
