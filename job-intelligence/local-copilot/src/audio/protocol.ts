import { z } from 'zod';

import type { AudioFrame, AudioSource } from './audio-frame';
import type { CaptureEvent, RawAudioChunk } from './capture-controller';

const PositiveSafeInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const AudioSourceSchema = z.enum(['microphone', 'system']);
const Pcm16Schema = z.custom<Int16Array>((value) => value instanceof Int16Array);
const AudioFrameSchema = z.object({
  source: AudioSourceSchema,
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  capturedAt: z.number().min(0),
  sampleRate: PositiveSafeInteger.max(384_000),
  channels: PositiveSafeInteger.max(32),
  pcm: Pcm16Schema.refine((pcm) => pcm.byteLength <= 1_048_576, 'PCM frame is too large.'),
}).strict().refine(({ pcm, channels }) => pcm.length % channels === 0, 'PCM channels do not divide frame length.');

export const AudioUtilityConfigSchema = z.object({
  targetSampleRate: PositiveSafeInteger.max(384_000),
  maxBufferedFrames: PositiveSafeInteger.max(256),
  jitterWindowMs: z.number().int().min(0).max(10_000),
  memoryOnly: z.literal(true).optional(),
  maxInFlightFrames: PositiveSafeInteger.max(64),
  vad: z.object({
    threshold: z.number().min(0).max(32_768),
    speechFrames: PositiveSafeInteger.max(1_000),
    silenceFrames: PositiveSafeInteger.max(1_000),
  }).strict(),
  capture: z.object({
    lifecycle: z.string().min(1).max(128),
    microphone: z.boolean(),
    systemAudio: z.boolean(),
    initialCredits: PositiveSafeInteger.max(256),
  }).strict().optional(),
}).strict();

export const RawAudioChunkSchema = z.object({
  source: AudioSourceSchema,
  capturedAt: z.number().min(0),
  sampleRate: PositiveSafeInteger.max(384_000),
  channels: PositiveSafeInteger.max(32),
  pcm: Pcm16Schema.refine((pcm) => pcm.byteLength <= 1_048_576, 'PCM chunk is too large.'),
}).strict().refine(({ pcm, channels }) => pcm.length % channels === 0, 'PCM channels do not divide sample length.');

export const AudioUtilityCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), config: AudioUtilityConfigSchema }).strict(),
  z.object({ type: z.literal('audio-chunk'), chunk: RawAudioChunkSchema }).strict(),
  z.object({ type: z.literal('source-lost'), source: AudioSourceSchema }).strict(),
  z.object({ type: z.literal('frame-ack'), sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ type: z.literal('stop') }).strict(),
]);

export const AudioUtilityConnectSchema = z.object({
  type: z.literal('connect'),
  lifecycle: z.string().min(1).max(128),
}).strict();

export const AudioCapturePortConnectSchema = z.object({
  type: z.literal('audio-capture-port'),
  lifecycle: z.string().min(1).max(128),
}).strict();

export const CaptureStreamCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('audio-chunk'),
    lifecycle: z.string().min(1).max(128),
    chunk: RawAudioChunkSchema,
  }).strict(),
  z.object({
    type: z.literal('source-lost'),
    lifecycle: z.string().min(1).max(128),
    source: AudioSourceSchema,
  }).strict(),
  z.object({ type: z.literal('capture-stopped'), lifecycle: z.string().min(1).max(128) }).strict(),
]);

export const CaptureHostCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start-capture'),
    lifecycle: z.string().min(1).max(128),
    config: z.object({ microphone: z.boolean(), systemAudio: z.boolean() }).strict(),
    credits: PositiveSafeInteger.max(256),
  }).strict(),
  z.object({
    type: z.literal('capture-credit'),
    lifecycle: z.string().min(1).max(128),
    count: PositiveSafeInteger.max(256),
  }).strict(),
  z.object({ type: z.literal('stop-capture'), lifecycle: z.string().min(1).max(128) }).strict(),
]);

export const AudioUtilityMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({ type: z.literal('frame'), frame: AudioFrameSchema }).strict(),
  z.object({ type: z.literal('source-lost'), source: AudioSourceSchema }).strict(),
  z.object({
    type: z.enum(['speech-start', 'speech-end']),
    source: AudioSourceSchema,
    capturedAt: z.number().min(0),
  }).strict(),
  z.object({
    type: z.literal('frames-dropped'),
    count: PositiveSafeInteger,
    lastSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  z.object({ type: z.literal('error'), fatal: z.literal(true), message: z.string().min(1).max(1_024) }).strict(),
  z.object({ type: z.literal('stopped') }).strict(),
]);

export type AudioUtilityConfig = z.infer<typeof AudioUtilityConfigSchema>;
export type AudioUtilityCommand =
  | { readonly type: 'start'; readonly config: AudioUtilityConfig }
  | { readonly type: 'audio-chunk'; readonly chunk: RawAudioChunk }
  | { readonly type: 'source-lost'; readonly source: AudioSource }
  | { readonly type: 'frame-ack'; readonly sequence: number }
  | { readonly type: 'stop' };

export type AudioUtilityMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'frame'; readonly frame: AudioFrame }
  | CaptureEvent
  | { readonly type: 'speech-start' | 'speech-end'; readonly source: AudioSource; readonly capturedAt: number }
  | { readonly type: 'frames-dropped'; readonly count: number; readonly lastSequence: number }
  | { readonly type: 'error'; readonly fatal: true; readonly message: string }
  | { readonly type: 'stopped' };

export type CaptureStreamCommand = z.infer<typeof CaptureStreamCommandSchema>;
export type CaptureHostCommand = z.infer<typeof CaptureHostCommandSchema>;

export function zeroCandidatePcm(command: unknown): void {
  if (typeof command !== 'object' || command === null) {
    return;
  }
  const record = command as Record<string, unknown>;
  for (const key of ['chunk', 'frame'] as const) {
    if (!(key in record)) continue;
    const candidate = record[key];
    if (typeof candidate === 'object' && candidate !== null && 'pcm' in candidate && candidate.pcm instanceof Int16Array) {
      candidate.pcm.fill(0);
    }
  }
}
