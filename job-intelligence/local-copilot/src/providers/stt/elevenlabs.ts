import { z } from 'zod';

import {
  StreamingTranscriptionAdapter,
  invalidEvent,
  providerError,
  type TranscriptEvent,
  type TranscriptionAdapter,
  type WebSocketFactory,
} from './types';

export interface ElevenLabsAdapterOptions {
  readonly apiKey: string;
  readonly webSocketFactory: WebSocketFactory;
}

const Partial = z.object({ message_type: z.literal('partial_transcript'), text: z.string() }).passthrough();
const Committed = z.object({
  message_type: z.enum(['committed_transcript', 'committed_transcript_with_timestamps']),
  text: z.string(),
}).passthrough();
const Ignored = z.object({
  message_type: z.enum([
    'session_started',
    'final_transcript',
    'final_transcript_with_timestamps',
    'committed_transcript_entities',
  ]),
}).passthrough();
const ProviderFailure = z.object({
  message_type: z.enum([
    'auth_error',
    'quota_exceeded',
    'rate_limited',
    'transcriber_error',
    'input_error',
    'invalid_request',
    'error',
    'commit_throttled',
    'unaccepted_terms',
    'queue_overflow',
    'resource_exhausted',
    'session_time_limit_exceeded',
    'chunk_size_exceeded',
    'insufficient_audio_activity',
  ]),
  error: z.string(),
}).passthrough();

export function createElevenLabsAdapter(options: ElevenLabsAdapterOptions): TranscriptionAdapter {
  let speaking = false;
  const url = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
  url.searchParams.set('model_id', 'scribe_v2_realtime');
  url.searchParams.set('audio_format', 'pcm_24000');
  url.searchParams.set('commit_strategy', 'vad');

  return new StreamingTranscriptionAdapter({
    connection: {
      url: url.toString(),
      headers: { 'xi-api-key': options.apiKey },
    },
    webSocketFactory: options.webSocketFactory,
    encodeAudio: (audio) => JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: Buffer.from(audio).toString('base64'),
    }),
    reset: () => { speaking = false; },
    parseEvent: (event) => {
      const partial = Partial.safeParse(event);
      if (partial.success) {
        const text = partial.data.text.trim();
        if (!text) return [];
        const normalized: TranscriptEvent[] = [];
        if (!speaking) {
          speaking = true;
          normalized.push({ type: 'speech-start' });
        }
        normalized.push({ type: 'partial', text });
        return normalized;
      }
      const committed = Committed.safeParse(event);
      if (committed.success) {
        const text = committed.data.text.trim();
        const normalized: TranscriptEvent[] = [];
        if (text && !speaking) normalized.push({ type: 'speech-start' });
        if (text) normalized.push({ type: 'final', text });
        if (speaking || text) normalized.push({ type: 'speech-end' });
        speaking = false;
        return normalized;
      }
      const failure = ProviderFailure.safeParse(event);
      if (failure.success) {
        if (failure.data.message_type === 'auth_error') {
          return [providerError('authentication', failure.data.error)];
        }
        if (['quota_exceeded', 'rate_limited'].includes(failure.data.message_type)) {
          return [providerError('quota', failure.data.error, failure.data.message_type === 'rate_limited')];
        }
        const retryable = ![
          'invalid_request',
          'input_error',
          'chunk_size_exceeded',
          'unaccepted_terms',
        ].includes(failure.data.message_type);
        return [providerError('provider', failure.data.error, retryable)];
      }
      if (Ignored.safeParse(event).success) return [];
      return [invalidEvent()];
    },
    classifyClose: (_code, reason) => providerError(
      'provider',
      reason || 'ElevenLabs connection closed unexpectedly.',
      true,
    ),
  });
}
