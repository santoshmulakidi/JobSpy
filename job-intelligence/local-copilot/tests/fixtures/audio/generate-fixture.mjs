import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sampleRate = 24_000;
const segments = [
  { durationMs: 100, amplitude: 0 },
  { durationMs: 220, amplitude: 8_000, frequency: 440 },
  { durationMs: 80, amplitude: 0 },
  { durationMs: 220, amplitude: 8_000, frequency: 660 },
  { durationMs: 200, amplitude: 0 },
];

const samples = [];
for (const segment of segments) {
  const sampleCount = Math.round((segment.durationMs / 1_000) * sampleRate);
  for (let index = 0; index < sampleCount; index += 1) {
    const value = segment.amplitude === 0
      ? 0
      : Math.round(segment.amplitude * Math.sin((2 * Math.PI * segment.frequency * index) / sampleRate));
    samples.push(value);
  }
}

const bytes = Buffer.alloc(samples.length * Int16Array.BYTES_PER_ELEMENT);
samples.forEach((sample, index) => bytes.writeInt16LE(sample, index * Int16Array.BYTES_PER_ELEMENT));

const outputPath = join(dirname(fileURLToPath(import.meta.url)), 'question-24k-mono.pcm');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, bytes);
