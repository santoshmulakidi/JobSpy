function clampPcm16(value: number): number {
  return Math.max(-32_768, Math.min(32_767, Math.round(value)));
}

/** Downmixes interleaved PCM16 and performs deterministic linear resampling. */
export function resamplePcm16Mono(
  input: Int16Array,
  inputSampleRate: number,
  inputChannels: number,
  outputSampleRate: number,
): Int16Array {
  return new StreamingPcm16Resampler(inputSampleRate, inputChannels, outputSampleRate).accept(input);
}

/** Preserves fractional phase and the interpolation boundary across capture callbacks. */
export class StreamingPcm16Resampler {
  private pending: number[] = [];
  private phaseNumerator = 0;

  public constructor(
    private readonly inputSampleRate: number,
    private readonly inputChannels: number,
    private readonly outputSampleRate: number,
  ) {
    if (
      !Number.isSafeInteger(inputSampleRate)
      || inputSampleRate <= 0
      || !Number.isSafeInteger(outputSampleRate)
      || outputSampleRate <= 0
      || !Number.isSafeInteger(inputChannels)
      || inputChannels <= 0
    ) {
      throw new RangeError('Audio rates and channel count must be positive safe integers.');
    }
  }

  public accept(input: Int16Array): Int16Array {
    if (input.length % this.inputChannels !== 0) {
      throw new RangeError('Interleaved PCM length must be divisible by its channel count.');
    }
    for (let frame = 0; frame < input.length / this.inputChannels; frame += 1) {
      let sum = 0;
      for (let channel = 0; channel < this.inputChannels; channel += 1) {
        sum += input[frame * this.inputChannels + channel] ?? 0;
      }
      this.pending.push(sum / this.inputChannels);
    }

    const output: number[] = [];
    while (this.phaseNumerator <= (this.pending.length - 1) * this.outputSampleRate) {
      const lower = Math.floor(this.phaseNumerator / this.outputSampleRate);
      const upper = Math.min(lower + 1, this.pending.length - 1);
      const fraction = (this.phaseNumerator % this.outputSampleRate) / this.outputSampleRate;
      output.push(clampPcm16(
        (this.pending[lower] ?? 0) * (1 - fraction) + (this.pending[upper] ?? 0) * fraction,
      ));
      this.phaseNumerator += this.inputSampleRate;
    }

    const consumed = Math.floor(this.phaseNumerator / this.outputSampleRate);
    if (consumed > 0) {
      this.pending.splice(0, Math.min(consumed, this.pending.length));
      this.phaseNumerator -= consumed * this.outputSampleRate;
    }
    return Int16Array.from(output);
  }

  public clear(): void {
    this.pending.fill(0);
    this.pending = [];
    this.phaseNumerator = 0;
  }
}
