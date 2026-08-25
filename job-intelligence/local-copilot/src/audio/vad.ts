import type { AudioFrame, AudioSource } from './audio-frame';

export interface VadConfig {
  readonly threshold: number;
  readonly speechFrames: number;
  readonly silenceFrames: number;
}

export type VadEvent =
  | { readonly type: 'speech-start'; readonly source: AudioSource; readonly capturedAt: number }
  | { readonly type: 'speech-end'; readonly source: AudioSource; readonly capturedAt: number };

const DEFAULT_CONFIG: VadConfig = {
  threshold: 800,
  speechFrames: 2,
  silenceFrames: 8,
};

interface SourceState {
  speaking: boolean;
  speechCount: number;
  silenceCount: number;
  candidateStartedAt: number;
}

export class VadDetector {
  private readonly config: VadConfig;
  private readonly states = new Map<AudioSource, SourceState>();

  public constructor(config: Partial<VadConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.threshold < 0 || this.config.speechFrames <= 0 || this.config.silenceFrames <= 0) {
      throw new RangeError('VAD configuration values are outside their valid range.');
    }
  }

  public accept(frame: AudioFrame): VadEvent[] {
    const state = this.states.get(frame.source) ?? {
      speaking: false,
      speechCount: 0,
      silenceCount: 0,
      candidateStartedAt: frame.capturedAt,
    };
    this.states.set(frame.source, state);

    const voiced = rootMeanSquare(frame.pcm) >= this.config.threshold;
    if (voiced) {
      state.silenceCount = 0;
      if (state.speechCount === 0) {
        state.candidateStartedAt = frame.capturedAt;
      }
      state.speechCount += 1;
      if (!state.speaking && state.speechCount >= this.config.speechFrames) {
        state.speaking = true;
        return [{ type: 'speech-start', source: frame.source, capturedAt: state.candidateStartedAt }];
      }
      return [];
    }

    state.speechCount = 0;
    if (!state.speaking) {
      return [];
    }
    state.silenceCount += 1;
    if (state.silenceCount < this.config.silenceFrames) {
      return [];
    }
    state.speaking = false;
    state.silenceCount = 0;
    return [{ type: 'speech-end', source: frame.source, capturedAt: frame.capturedAt }];
  }
}

function rootMeanSquare(samples: Int16Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sumSquares = 0;
  for (const sample of samples) {
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / samples.length);
}
