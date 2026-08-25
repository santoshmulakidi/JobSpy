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
  if (inputSampleRate <= 0 || outputSampleRate <= 0 || !Number.isInteger(inputChannels) || inputChannels <= 0) {
    throw new RangeError('Audio rates and channel count must be positive.');
  }
  if (input.length % inputChannels !== 0) {
    throw new RangeError('Interleaved PCM length must be divisible by its channel count.');
  }
  if (inputSampleRate === outputSampleRate && inputChannels === 1) {
    return input;
  }

  const inputFrames = input.length / inputChannels;
  if (inputFrames === 0) {
    return new Int16Array();
  }
  const mono = new Float64Array(inputFrames);
  for (let frame = 0; frame < inputFrames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < inputChannels; channel += 1) {
      sum += input[frame * inputChannels + channel] ?? 0;
    }
    mono[frame] = sum / inputChannels;
  }

  const outputFrames = Math.max(1, Math.round((inputFrames * outputSampleRate) / inputSampleRate));
  const output = new Int16Array(outputFrames);
  const sourceStep = inputSampleRate / outputSampleRate;
  for (let frame = 0; frame < outputFrames; frame += 1) {
    const sourcePosition = Math.min(frame * sourceStep, inputFrames - 1);
    const lower = Math.floor(sourcePosition);
    const upper = Math.min(lower + 1, inputFrames - 1);
    const fraction = sourcePosition - lower;
    output[frame] = clampPcm16((mono[lower] ?? 0) * (1 - fraction) + (mono[upper] ?? 0) * fraction);
  }
  return output;
}
