import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createAudioFrame, type AudioFrame } from '../../src/audio/audio-frame';
import { RecordingWriter } from '../../src/audio/recording-writer';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function frame(source: 'microphone' | 'system', sequence: number, samples: number[]): AudioFrame {
  return createAudioFrame({
    source,
    sequence,
    capturedAt: sequence * 20,
    sampleRate: 24_000,
    channels: 1,
    pcm: new Int16Array(samples),
  });
}

describe('RecordingWriter', () => {
  it('writes mono 24 kHz WAV files and reports count-only closure', () => {
    const directory = mkdtempSync(join(tmpdir(), 'local-copilot-recording-'));
    directories.push(directory);
    const writer = new RecordingWriter({ directory, sessionId: 'session-1', source: 'microphone' });

    writer.writeFrame(frame('microphone', 0, [1, -2, 3]));
    writer.writeFrame(frame('microphone', 1, [100, 200]));
    const closed = writer.close();

    expect(closed).toMatchObject({ bytesWritten: 44 + 10, framesWritten: 2 });
    expect(closed!.fileReference).toBe(join(directory, 'copilot-session-1-microphone.wav'));
    expect(existsSync(closed!.fileReference)).toBe(true);

    const bytes = readFileSync(closed!.fileReference);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(bytes.readUInt32LE(4)).toBe(36 + 10);
    expect(bytes.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(bytes.readUInt32LE(24)).toBe(24_000);
    expect(bytes.readUInt16LE(34)).toBe(16);
    expect(bytes.subarray(36, 40).toString('ascii')).toBe('data');
    expect(bytes.readUInt32LE(40)).toBe(10);
  });

  it('keeps sources isolated in separate files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'local-copilot-recording-'));
    directories.push(directory);
    const microphone = new RecordingWriter({ directory, sessionId: 'session-1', source: 'microphone' });
    const system = new RecordingWriter({ directory, sessionId: 'session-1', source: 'system' });
    microphone.writeFrame(frame('microphone', 0, [5]));
    system.writeFrame(frame('system', 0, [6]));

    expect(microphone.fileReference).not.toBe(system.fileReference);
    expect(microphone.close()).toMatchObject({ framesWritten: 1 });
    expect(system.close()).toMatchObject({ framesWritten: 1 });
  });

  it('rejects relative directories and mismatched frame formats', () => {
    expect(() => new RecordingWriter({ directory: 'recordings', sessionId: 's', source: 'microphone' }))
      .toThrow(/absolute/i);

    const directory = mkdtempSync(join(tmpdir(), 'local-copilot-recording-'));
    directories.push(directory);
    const writer = new RecordingWriter({ directory, sessionId: 'session-2', source: 'system' });
    expect(() => writer.writeFrame({ ...frame('system', 0, [1]), sampleRate: 48_000 })).toThrow(/mono 24 kHz/);
    expect(existsSync(writer.fileReference)).toBe(false);
  });

  it('discards partial files and ignores repeated closure', () => {
    const directory = mkdtempSync(join(tmpdir(), 'local-copilot-recording-'));
    directories.push(directory);
    const writer = new RecordingWriter({ directory, sessionId: 'session-3', source: 'microphone' });
    writer.writeFrame(frame('microphone', 0, [9, 9]));

    writer.discard();
    expect(existsSync(writer.fileReference)).toBe(false);
    expect(writer.close()).toBeNull();

    const untouched = new RecordingWriter({ directory, sessionId: 'session-4', source: 'microphone' });
    expect(untouched.close()).toBeNull();
    expect(existsSync(untouched.fileReference)).toBe(false);
  });
});
