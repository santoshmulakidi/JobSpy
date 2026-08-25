import { contextBridge, ipcRenderer } from 'electron';

import { IPC_METHODS, type IpcChannel, type IpcMethodResponse, type IpcRequest } from '../shared/contracts';

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

export const copilot = {
  session: {
    start: (request: IpcRequest<'session:start'>) => invoke('session:start', request),
    pause: () => invoke('session:pause', undefined),
    stop: () => invoke('session:stop', undefined),
    status: () => invoke('session:status', undefined),
  },
  providers: {
    list: () => invoke('providers:list', undefined),
    test: (request: IpcRequest<'providers:test'>) => invoke('providers:test', request),
    saveSecret: (request: IpcRequest<'providers:save-secret'>) => invoke('providers:save-secret', request),
  },
  capture: {
    preview: (request: IpcRequest<'capture:preview'>) => invoke('capture:preview', request),
    confirm: (request: IpcRequest<'capture:confirm'>) => invoke('capture:confirm', request),
    discard: (request: IpcRequest<'capture:discard'>) => invoke('capture:discard', request),
  },
  history: {
    list: (request: IpcRequest<'history:list'>) => invoke('history:list', request),
    get: (request: IpcRequest<'history:get'>) => invoke('history:get', request),
    delete: (request: IpcRequest<'history:delete'>) => invoke('history:delete', request),
    export: (request: IpcRequest<'history:export'>) => invoke('history:export', request),
  },
  overlay: {
    setOpacity: (request: IpcRequest<'overlay:set-opacity'>) => invoke('overlay:set-opacity', request),
    setClickThrough: (request: IpcRequest<'overlay:set-click-through'>) =>
      invoke('overlay:set-click-through', request),
    setAlwaysOnTop: (request: IpcRequest<'overlay:set-always-on-top'>) =>
      invoke('overlay:set-always-on-top', request),
    setCaptureProtection: (request: IpcRequest<'overlay:set-capture-protection'>) =>
      invoke('overlay:set-capture-protection', request),
    hide: () => invoke('overlay:hide', undefined),
  },
};

contextBridge.exposeInMainWorld('copilot', copilot);

declare global {
  interface Window {
    copilot: typeof copilot;
  }
}
