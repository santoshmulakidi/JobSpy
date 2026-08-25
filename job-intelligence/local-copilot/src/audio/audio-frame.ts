export type AudioSource = 'microphone' | 'system';

export interface AudioFrame {
  readonly source: AudioSource;
  readonly sequence: number;
  readonly capturedAt: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly pcm: Int16Array;
}

export function createAudioFrame(frame: AudioFrame): AudioFrame {
  if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 0) {
    throw new RangeError('Audio frame sequence must be a non-negative safe integer.');
  }
  if (!Number.isFinite(frame.capturedAt)) {
    throw new RangeError('Audio frame timestamp must be finite.');
  }
  if (!Number.isSafeInteger(frame.sampleRate) || frame.sampleRate <= 0) {
    throw new RangeError('Audio frame sample rate must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(frame.channels) || frame.channels <= 0) {
    throw new RangeError('Audio frame channel count must be a positive safe integer.');
  }
  return frame;
}
