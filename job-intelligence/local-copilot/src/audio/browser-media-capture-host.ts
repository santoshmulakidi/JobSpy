import type { AudioSource } from './audio-frame';
import type { RawAudioChunk } from './capture-controller';

export interface BrowserCaptureConfig {
  readonly microphone: boolean;
  readonly systemAudio: boolean;
}

interface CaptureConnection {
  release(): void;
}

interface SourceResources {
  readonly stream: MediaStream;
  readonly connection: CaptureConnection;
}

type ConnectStream = (
  stream: MediaStream,
  source: AudioSource,
  onChunk: (chunk: RawAudioChunk) => void,
  onSourceLost: (source: AudioSource) => void,
) => CaptureConnection;

interface BrowserMediaCaptureHostOptions {
  readonly mediaDevices?: Pick<MediaDevices, 'getDisplayMedia' | 'getUserMedia'>;
  readonly connectStream?: ConnectStream;
  readonly now?: () => number;
}

/** Runs only in a sandboxed renderer capture host; it transfers PCM to the utility process. */
export class BrowserMediaCaptureHost {
  private readonly mediaDevices: Pick<MediaDevices, 'getDisplayMedia' | 'getUserMedia'>;
  private readonly connectStream: ConnectStream;
  private readonly resources = new Map<AudioSource, SourceResources>();
  private epoch = 0;

  public constructor(options: BrowserMediaCaptureHostOptions = {}) {
    this.mediaDevices = options.mediaDevices ?? navigator.mediaDevices;
    this.connectStream = options.connectStream ?? ((stream, source, onChunk, onSourceLost) =>
      connectWebAudioStream(stream, source, onChunk, onSourceLost, options.now));
  }

  public async start(
    config: BrowserCaptureConfig,
    onChunk: (chunk: RawAudioChunk) => void,
    onSourceLost: (source: AudioSource) => void,
  ): Promise<void> {
    const epoch = this.beginLifecycle();
    try {
      if (config.systemAudio) {
        const stream = await this.mediaDevices.getDisplayMedia({ audio: true, video: true });
        if (epoch !== this.epoch) {
          stopStream(stream);
          return;
        }
        for (const track of stream.getVideoTracks()) {
          track.stop();
        }
        this.attach(epoch, stream, 'system', onChunk, onSourceLost);
      }
      if (config.microphone) {
        const stream = await this.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        if (epoch !== this.epoch) {
          stopStream(stream);
          return;
        }
        this.attach(epoch, stream, 'microphone', onChunk, onSourceLost);
      }
    } catch (error) {
      if (epoch === this.epoch) {
        this.releaseAll();
      }
      throw error;
    }
  }

  public stop(): void {
    this.epoch += 1;
    this.releaseAll();
  }

  private attach(
    epoch: number,
    stream: MediaStream,
    source: AudioSource,
    onChunk: (chunk: RawAudioChunk) => void,
    onSourceLost: (source: AudioSource) => void,
  ): void {
    const connection = this.connectStream(stream, source, onChunk, () => {
      if (epoch !== this.epoch) {
        return;
      }
      this.releaseSource(source);
      onSourceLost(source);
    });
    this.resources.set(source, { stream, connection });
  }

  private beginLifecycle(): number {
    this.epoch += 1;
    this.releaseAll();
    return this.epoch;
  }

  private releaseAll(): void {
    for (const source of [...this.resources.keys()]) {
      this.releaseSource(source);
    }
  }

  private releaseSource(source: AudioSource): void {
    const resource = this.resources.get(source);
    if (!resource) {
      return;
    }
    this.resources.delete(source);
    for (const track of resource.stream.getTracks()) {
      track.onended = null;
    }
    resource.connection.release();
    stopStream(resource.stream);
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.onended = null;
    track.stop();
  }
}

function connectWebAudioStream(
  stream: MediaStream,
  source: AudioSource,
  onChunk: (chunk: RawAudioChunk) => void,
  onSourceLost: (source: AudioSource) => void,
  now: (() => number) | undefined,
): CaptureConnection {
  const context = new AudioContext();
  const input = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(2_048, 1, 1);
  const mutedOutput = context.createGain();
  mutedOutput.gain.value = 0;
  input.connect(processor);
  processor.connect(mutedOutput);
  mutedOutput.connect(context.destination);
  processor.onaudioprocess = (event) => {
    const channels = event.inputBuffer.numberOfChannels;
    const samplesPerChannel = event.inputBuffer.length;
    const interleaved = new Int16Array(samplesPerChannel * channels);
    for (let channel = 0; channel < channels; channel += 1) {
      const samples = event.inputBuffer.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
        interleaved[index * channels + channel] = Math.round(sample * (sample < 0 ? 32_768 : 32_767));
      }
    }
    onChunk({
      source,
      capturedAt: now?.() ?? performance.timeOrigin + performance.now(),
      sampleRate: context.sampleRate,
      channels,
      pcm: interleaved,
    });
  };
  for (const track of stream.getAudioTracks()) {
    track.onended = () => onSourceLost(source);
  }
  return {
    release() {
      processor.onaudioprocess = null;
      input.disconnect();
      processor.disconnect();
      mutedOutput.disconnect();
      void context.close();
    },
  };
}
