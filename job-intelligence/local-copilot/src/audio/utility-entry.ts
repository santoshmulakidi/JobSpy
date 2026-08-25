import type { AudioFrame, AudioSource } from './audio-frame';
import {
  CaptureController,
  type CaptureConfig,
  type CaptureEvent,
  type RawAudioChunk,
} from './capture-controller';

export type AudioUtilityCommand =
  | { readonly type: 'start'; readonly config: CaptureConfig }
  | { readonly type: 'audio-chunk'; readonly chunk: RawAudioChunk }
  | { readonly type: 'source-lost'; readonly source: AudioSource }
  | { readonly type: 'stop' };

export type AudioUtilityMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'frame'; readonly frame: AudioFrame }
  | CaptureEvent
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'stopped' };

export interface AudioUtilityPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  off(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  postMessage(message: AudioUtilityMessage): void;
}

export interface AudioUtilityHandle {
  readonly closed: Promise<void>;
}

/** Installs the Node-only utility runtime. Browser media APIs remain in BrowserMediaCaptureHost. */
export function startAudioUtility(port: AudioUtilityPort): AudioUtilityHandle {
  const controller = new CaptureController();
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let started = false;

  const pumpFrames = async () => {
    for await (const frame of controller.frames()) {
      const transferredFrame = { ...frame, pcm: frame.pcm.slice() };
      port.postMessage({ type: 'frame', frame: transferredFrame });
      frame.pcm.fill(0);
    }
  };
  const pumpEvents = async () => {
    for await (const event of controller.events()) {
      port.postMessage(event);
    }
  };

  const onMessage = (event: { data: unknown }) => {
    const command = event.data as AudioUtilityCommand;
    try {
      switch (command?.type) {
        case 'start':
          if (started) {
            throw new Error('Audio utility capture is already started.');
          }
          controller.start(command.config);
          started = true;
          void pumpFrames();
          void pumpEvents();
          break;
        case 'audio-chunk':
          controller.accept(command.chunk);
          break;
        case 'source-lost':
          controller.sourceLost(command.source);
          break;
        case 'stop':
          controller.stop();
          port.off('message', onMessage);
          port.postMessage({ type: 'stopped' });
          resolveClosed();
          break;
        default:
          throw new Error('Unsupported audio utility command.');
      }
    } catch (error) {
      port.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Audio utility failed.' });
    }
  };

  port.on('message', onMessage);
  port.postMessage({ type: 'ready' });
  return { closed };
}

const utilityParentPort = process.parentPort;
if (utilityParentPort) {
  startAudioUtility(utilityParentPort);
}
