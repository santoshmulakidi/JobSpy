import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  COPILOT_EVENT_CHANNEL,
  CopilotMainEvent,
  IPC_METHODS,
  type CopilotBridge,
  type CopilotMainEventValue,
  type IpcChannel,
  type IpcMethodResponse,
  type IpcRequest,
} from '../shared/contracts';

const invalidRequest = {
  ok: false as const,
  error: { code: 'INVALID_REQUEST' as const, message: 'Invalid request.' },
};

async function invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<IpcMethodResponse<C>> {
  const request = IPC_METHODS[channel].request.safeParse(payload);
  if (!request.success) {
    return invalidRequest as IpcMethodResponse<C>;
  }

  return ipcRenderer.invoke(channel, request.data) as Promise<IpcMethodResponse<C>>;
}

export const copilot: CopilotBridge = {
  session: {
    start: (request: IpcRequest<'session:start'>) => invoke('session:start', request),
    stop: (request: IpcRequest<'session:stop'>) => invoke('session:stop', request),
    status: () => invoke('session:status', undefined),
  },
  providers: {
    list: () => invoke('providers:list', undefined),
    saveSecret: (request: IpcRequest<'providers:save-secret'>) => invoke('providers:save-secret', request),
  },
  capture: {
    preview: (request: IpcRequest<'capture:preview'>) => invoke('capture:preview', request),
    confirm: (request: IpcRequest<'capture:confirm'>) => invoke('capture:confirm', request),
    discard: (request: IpcRequest<'capture:discard'>) => invoke('capture:discard', request),
  },
  history: {
    list: (request: IpcRequest<'history:list'>) => invoke('history:list', request),
    remove: (request: IpcRequest<'history:delete'>) => invoke('history:delete', request),
    export: (request: IpcRequest<'history:export'>) => invoke('history:export', request),
  },
  overlay: {
    setOpacity: (request: IpcRequest<'overlay:set-opacity'>) => invoke('overlay:set-opacity', request),
    setAlwaysOnTop: (request: IpcRequest<'overlay:set-always-on-top'>) =>
      invoke('overlay:set-always-on-top', request),
    move: (request: IpcRequest<'overlay:move'>) => invoke('overlay:move', request),
    hide: () => invoke('overlay:hide', undefined),
  },
  answer: {
    send: (request: IpcRequest<'answer:send'>) => invoke('answer:send', request),
    cancel: () => invoke('answer:cancel', undefined),
  },
  onAnswerEvent(listener: (event: CopilotMainEventValue) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: unknown): void => {
      const parsed = CopilotMainEvent.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(COPILOT_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(COPILOT_EVENT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('copilot', copilot);

declare global {
  interface Window {
    copilot: typeof copilot;
  }
}
