import { CaptureController } from './capture-controller';
import {
  AudioUtilityCommandSchema,
  AudioUtilityConnectSchema,
  CaptureStreamCommandSchema,
  type CaptureHostCommand,
  type AudioUtilityConfig,
  type AudioUtilityMessage,
  zeroCandidatePcm,
} from './protocol';
import { VadDetector } from './vad';

export type { AudioUtilityCommand, AudioUtilityConfig, AudioUtilityMessage } from './protocol';

export interface AudioUtilityPort {
  on(event: 'message', listener: (event: { data: unknown; ports?: AudioUtilityPort[] }) => void): unknown;
  off(event: 'message', listener: (event: { data: unknown; ports?: AudioUtilityPort[] }) => void): unknown;
  postMessage(message: AudioUtilityMessage | CaptureHostCommand): void;
  start?(): void;
  close?(): void;
}

export interface AudioUtilityHandle {
  readonly closed: Promise<void>;
}

/** Installs the Node-only utility runtime. Browser media APIs remain in BrowserMediaCaptureHost. */
export function startAudioUtility(
  port: AudioUtilityPort,
  capturePort: AudioUtilityPort = port,
  expectedLifecycle?: string,
): AudioUtilityHandle {
  const controller = new CaptureController();
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let started = false;
  let stopped = false;
  let stopping = false;
  let stopErrorMessage: string | undefined;
  let vad: VadDetector | null = null;
  let config: AudioUtilityConfig | null = null;
  const inFlight = new Set<number>();
  let droppedSinceAck = 0;
  let lastDroppedSequence = -1;

  const finishStop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    port.off('message', onMessage);
    if (capturePort !== port) {
      capturePort.off('message', onCaptureMessage);
    }
    if (stopErrorMessage) {
      port.postMessage({ type: 'error', fatal: true, message: stopErrorMessage });
    }
    port.postMessage({ type: 'stopped' });
    if (capturePort !== port) {
      capturePort.close?.();
    }
    resolveClosed();
  };

  const requestStop = (errorMessage?: string) => {
    if (stopped) {
      return;
    }
    stopErrorMessage ??= errorMessage;
    if (stopping) {
      return;
    }
    stopping = true;
    controller.stop();
    inFlight.clear();
    port.off('message', onMessage);
    if (config?.capture && capturePort !== port) {
      capturePort.postMessage({ type: 'stop-capture', lifecycle: config.capture.lifecycle });
      return;
    }
    finishStop();
  };

  const pumpFrames = async () => {
    try {
      for await (const frame of controller.frames()) {
        try {
          for (const event of vad?.accept(frame) ?? []) {
            port.postMessage(event);
          }
          if (!config || inFlight.size >= config.maxInFlightFrames) {
            droppedSinceAck += 1;
            lastDroppedSequence = frame.sequence;
            continue;
          }
          const transferredFrame = { ...frame, pcm: frame.pcm.slice() };
          inFlight.add(frame.sequence);
          try {
            port.postMessage({ type: 'frame', frame: transferredFrame });
          } finally {
            transferredFrame.pcm.fill(0);
          }
        } finally {
          frame.pcm.fill(0);
        }
      }
    } catch {
      requestStop('Audio utility processing failed.');
    }
  };
  const pumpEvents = async () => {
    for await (const event of controller.events()) {
      port.postMessage(event);
    }
  };

  const onMessage = (event: { data: unknown }) => {
    const parsed = AudioUtilityCommandSchema.safeParse(event.data);
    if (!parsed.success) {
      zeroCandidatePcm(event.data);
      requestStop('Invalid audio utility command.');
      return;
    }
    const command = parsed.data;
    try {
      switch (command?.type) {
        case 'start':
          if (started) {
            throw new Error('Audio utility capture is already started.');
          }
          config = command.config;
          if (expectedLifecycle && command.config.capture?.lifecycle !== expectedLifecycle) {
            throw new Error('Capture lifecycle does not match the attached port.');
          }
          controller.start(command.config);
          vad = new VadDetector(command.config.vad);
          started = true;
          void pumpFrames();
          void pumpEvents();
          if (command.config.capture) {
            capturePort.postMessage({
              type: 'start-capture',
              lifecycle: command.config.capture.lifecycle,
              config: {
                microphone: command.config.capture.microphone,
                systemAudio: command.config.capture.systemAudio,
              },
              credits: command.config.capture.initialCredits,
            });
          }
          break;
        case 'audio-chunk':
          controller.accept(command.chunk);
          break;
        case 'source-lost':
          controller.sourceLost(command.source);
          break;
        case 'frame-ack':
          if (inFlight.delete(command.sequence) && droppedSinceAck > 0) {
            port.postMessage({
              type: 'frames-dropped',
              count: droppedSinceAck,
              lastSequence: lastDroppedSequence,
            });
            droppedSinceAck = 0;
            lastDroppedSequence = -1;
          }
          break;
        case 'stop':
          requestStop();
          break;
        default:
          throw new Error('Unsupported audio utility command.');
      }
    } catch {
      zeroCandidatePcm(event.data);
      requestStop('Audio utility processing failed.');
    }
  };

  const onCaptureMessage = (event: { data: unknown }) => {
    const parsed = CaptureStreamCommandSchema.safeParse(event.data);
    if (!parsed.success || !config?.capture || parsed.data.lifecycle !== config.capture.lifecycle) {
      zeroCandidatePcm(event.data);
      requestStop('Invalid capture stream command.');
      return;
    }
    const command = parsed.data;
    try {
      switch (command.type) {
        case 'audio-chunk':
          controller.accept(command.chunk);
          capturePort.postMessage({
            type: 'capture-credit',
            lifecycle: config.capture.lifecycle,
            count: 1,
          });
          break;
        case 'source-lost':
          controller.sourceLost(command.source);
          break;
        case 'capture-ready':
          port.postMessage(command);
          break;
        case 'capture-error':
          port.postMessage(command);
          requestStop();
          break;
        case 'capture-stopped':
          if (!stopping) {
            stopping = true;
            controller.stop();
            inFlight.clear();
            port.off('message', onMessage);
          }
          finishStop();
          break;
      }
    } catch {
      zeroCandidatePcm(event.data);
      requestStop('Audio utility processing failed.');
    }
  };

  port.on('message', onMessage);
  port.start?.();
  if (capturePort !== port) {
    capturePort.on('message', onCaptureMessage);
    capturePort.start?.();
  }
  port.postMessage({ type: 'ready' });
  return { closed };
}

export function startAudioUtilityParentPort(parentPort: AudioUtilityPort): Promise<AudioUtilityHandle> {
  return new Promise((resolve, reject) => {
    const onConnect = (event: { data: unknown; ports?: AudioUtilityPort[] }) => {
      const parsed = AudioUtilityConnectSchema.safeParse(event.data);
      const [capturePort, ...extraPorts] = event.ports ?? [];
      if (!parsed.success || !capturePort || extraPorts.length > 0) {
        parentPort.off('message', onConnect);
        parentPort.postMessage({ type: 'error', fatal: true, message: 'Invalid audio utility connection.' });
        parentPort.postMessage({ type: 'stopped' });
        reject(new Error('Invalid audio utility connection.'));
        return;
      }
      parentPort.off('message', onConnect);
      resolve(startAudioUtility(parentPort, capturePort, parsed.data.lifecycle));
    };
    parentPort.on('message', onConnect);
  });
}

const utilityParentPort = process.parentPort;
if (utilityParentPort) {
  void startAudioUtilityParentPort(utilityParentPort)
    .then(({ closed }) => closed)
    .then(() => { setImmediate(() => process.exit(0)); })
    .catch(() => { setImmediate(() => process.exit(1)); });
}
