import { z } from 'zod';

import {
  StreamingTranscriptionAdapter,
  invalidEvent,
  providerError,
  type TranscriptEvent,
  type TranscriptionAdapter,
  type WebSocketFactory,
} from './types';

export interface DeepgramAdapterOptions {
  readonly apiKey: string;
  readonly webSocketFactory: WebSocketFactory;
}

const Results = z.object({
  type: z.literal('Results'),
  is_final: z.boolean(),
  speech_final: z.boolean(),
  channel: z.object({
    alternatives: z.array(z.object({ transcript: z.string() }).passthrough()).min(1),
  }).passthrough(),
}).passthrough();
const SpeechStarted = z.object({ type: z.literal('SpeechStarted') }).passthrough();
const UtteranceEnd = z.object({ type: z.literal('UtteranceEnd') }).passthrough();
const Ignored = z.object({ type: z.enum(['Metadata']) }).passthrough();

export function createDeepgramAdapter(options: DeepgramAdapterOptions): TranscriptionAdapter {
  let speaking = false;
  const url = new URL('wss://api.deepgram.com/v1/listen');
  for (const [key, value] of Object.entries({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: '24000',
    channels: '1',
    interim_results: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
    vad_events: 'true',
    smart_format: 'true',
  })) url.searchParams.set(key, value);

  return new StreamingTranscriptionAdapter({
    connection: {
      url: url.toString(),
      headers: { Authorization: `Token ${options.apiKey}` },
    },
    webSocketFactory: options.webSocketFactory,
    encodeAudio: (audio) => audio,
    closeMessage: JSON.stringify({ type: 'CloseStream' }),
    closeTimeoutMs: 1_000,
    reset: () => { speaking = false; },
    parseEvent: (event) => {
      const started = SpeechStarted.safeParse(event);
      if (started.success) {
        if (speaking) return [];
        speaking = true;
        return [{ type: 'speech-start' }];
      }
      const ended = UtteranceEnd.safeParse(event);
      if (ended.success) {
        if (!speaking) return [];
        speaking = false;
        return [{ type: 'speech-end' }];
      }
      const results = Results.safeParse(event);
      if (results.success) {
        const text = results.data.channel.alternatives[0]!.transcript.trim();
        const normalized: TranscriptEvent[] = [];
        if (text && !speaking) {
          speaking = true;
          normalized.push({ type: 'speech-start' });
        }
        if (text) normalized.push({ type: results.data.is_final ? 'final' : 'partial', text });
        if (results.data.speech_final && speaking) {
          speaking = false;
          normalized.push({ type: 'speech-end' });
        }
        return normalized;
      }
      if (Ignored.safeParse(event).success) return [];
      return [invalidEvent()];
    },
    classifyClose: (_code, reason) => {
      const normalized = reason.toUpperCase();
      if (normalized.includes('AUTH') || normalized.includes('PERMISSION')) {
        return providerError('authentication', reason || 'Deepgram authentication failed.');
      }
      if (normalized.includes('PAYMENT') || normalized.includes('QUOTA') || normalized.includes('LIMIT')) {
        return providerError('quota', reason || 'Deepgram quota was exceeded.');
      }
      return providerError('provider', reason || 'Deepgram connection closed unexpectedly.', true);
    },
    classifyError: (event) => {
      if (event.type === 'upgrade' && [401, 403].includes(event.status)) {
        return providerError('authentication', event.message);
      }
      return providerError('provider', event.message, true);
    },
  });
}
