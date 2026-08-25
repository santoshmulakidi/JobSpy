import type { CaptureHost } from './audio-capture-runtime';
import { AudioCaptureRuntime, type CaptureRuntimePort } from './audio-capture-runtime';
import { AudioCapturePortConnectSchema } from './protocol';

interface TransferEvent {
  readonly ports: unknown[];
}

interface CapturePreloadIpc {
  on(
    channel: 'audio:capture-port',
    listener: (event: TransferEvent, message: unknown) => void,
  ): unknown;
}

interface DomMessagePort {
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

function isCaptureRuntimePort(port: unknown): port is CaptureRuntimePort {
  return typeof port === 'object' && port !== null
    && 'on' in port && typeof port.on === 'function'
    && 'off' in port && typeof port.off === 'function';
}

function adaptMessagePort(port: unknown): CaptureRuntimePort | null {
  if (isCaptureRuntimePort(port)) {
    return port;
  }
  if (typeof port !== 'object' || port === null) {
    return null;
  }
  const candidate = port as Partial<DomMessagePort>;
  if (typeof candidate.postMessage !== 'function'
    || typeof candidate.start !== 'function'
    || typeof candidate.close !== 'function'
    || typeof candidate.addEventListener !== 'function'
    || typeof candidate.removeEventListener !== 'function') {
    return null;
  }
  const closeListeners = new Set<() => void>();
  return {
    on(event, listener) {
      if (event === 'message') {
        candidate.addEventListener?.('message', listener as (event: MessageEvent<unknown>) => void);
      } else {
        closeListeners.add(listener as () => void);
      }
    },
    off(event, listener) {
      if (event === 'message') {
        candidate.removeEventListener?.('message', listener as (event: MessageEvent<unknown>) => void);
      } else {
        closeListeners.delete(listener as () => void);
      }
    },
    postMessage: (message) => candidate.postMessage?.(message),
    start: () => candidate.start?.(),
    close: () => {
      candidate.close?.();
      for (const listener of closeListeners) listener();
      closeListeners.clear();
    },
  };
}

/** Installs the sole capture-only IPC endpoint in the sandboxed capture preload. */
export function installCapturePreload(ipc: CapturePreloadIpc, host: CaptureHost): AudioCaptureRuntime {
  const runtime = new AudioCaptureRuntime(host);
  ipc.on('audio:capture-port', (event, message) => {
    const parsed = AudioCapturePortConnectSchema.safeParse(message);
    if (!parsed.success || event.ports.length !== 1) {
      for (const port of event.ports) {
        if (typeof port === 'object' && port !== null && 'close' in port && typeof port.close === 'function') {
          port.close();
        }
      }
      runtime.disconnect(false);
      return;
    }
    const port = adaptMessagePort(event.ports[0]);
    if (!port) {
      runtime.disconnect(false);
      return;
    }
    runtime.connect(port, parsed.data.lifecycle);
  });
  return runtime;
}
