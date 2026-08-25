import { closeSync, mkdirSync, openSync, unlinkSync, writeSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import type { AudioFrame, AudioSource } from './audio-frame';

export interface RecordingWriterOptions {
  /** Absolute path to the user-selected recordings folder. Created when missing. */
  readonly directory: string;
  readonly sessionId: string;
  readonly source: AudioSource;
}

export interface ClosedRecording {
  readonly fileReference: string;
  readonly bytesWritten: number;
  readonly framesWritten: number;
}

const WAV_HEADER_BYTES = 44;

function asciiView(value: string): Buffer {
  return Buffer.from(value, 'ascii');
}

/**
 * Explicit opt-in recorder. It exists so that raw audio never touches disk
 * unless the user both saves sessions and selects a recordings folder.
 */
export class RecordingWriter {
  private readonly directory: string;
  private readonly fileName: string;
  private handle: number | null = null;
  private dataBytes = 0;
  private frameCount = 0;
  private closed = false;

  public constructor(options: RecordingWriterOptions) {
    if (!isAbsolute(options.directory)) {
      throw new Error('The recordings directory must be an absolute user-selected path.');
    }
    if (!/^[A-Za-z]:[\\/].+/.test(options.directory) && !options.directory.startsWith('\\\\')) {
      throw new Error('The recordings directory must be a local folder.');
    }
    this.directory = resolve(options.directory);
    mkdirSync(this.directory, { recursive: true });
    this.fileName = `copilot-${options.sessionId}-${options.source}.wav`;
  }

  get fileReference(): string {
    return join(this.directory, this.fileName);
  }

  public writeFrame(frame: AudioFrame): void {
    if (this.closed) {
      throw new Error('The recording has already been closed.');
    }
    if (frame.sampleRate !== 24_000 || frame.channels !== 1) {
      throw new Error('Recordings expect mono 24 kHz frames from the audio pipeline.');
    }
    if (this.handle === null) {
      this.handle = openSync(this.fileReference, 'w');
      writeSync(this.handle, this.header(0));
    }
    const pcm = Buffer.from(frame.pcm.buffer, frame.pcm.byteOffset, frame.pcm.byteLength);
    writeSync(this.handle, pcm);
    this.dataBytes += pcm.byteLength;
    this.frameCount += 1;
  }

  public close(): ClosedRecording | null {
    if (this.closed) return null;
    this.closed = true;
    if (this.handle === null) return null;
    writeSync(this.handle, this.header(this.dataBytes), 0, WAV_HEADER_BYTES, 0);
    closeSync(this.handle);
    this.handle = null;
    return {
      fileReference: this.fileReference,
      bytesWritten: WAV_HEADER_BYTES + this.dataBytes,
      framesWritten: this.frameCount,
    };
  }

  /** Closes and removes any partial recording. Best-effort cleanup. */
  public discard(): void {
    const reference = this.fileReference;
    if (!this.closed) {
      this.closed = true;
      if (this.handle !== null) {
        closeSync(this.handle);
        this.handle = null;
      }
    }
    try {
      unlinkSync(reference);
    } catch {
      // The file may never have been created; nothing else to clean up.
    }
  }

  private header(dataBytes: number): Buffer {
    const header = Buffer.alloc(WAV_HEADER_BYTES);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + dataBytes, 4);
    header.write('WAVE', 8, 'ascii');
    asciiView('fmt ').copy(header, 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(24_000, 24);
    header.writeUInt32LE(48_000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    asciiView('data').copy(header, 36);
    header.writeUInt32LE(dataBytes, 40);
    return header;
  }
}
