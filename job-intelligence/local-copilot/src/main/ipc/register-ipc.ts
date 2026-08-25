import { ipcMain } from 'electron';

import {
  IPC_METHODS,
  type IpcChannel,
  type IpcErrorCode,
  type IpcMethodResponse,
} from '../../shared/contracts';

type IpcSenderEvent = {
  senderFrame?: {
    parent: unknown | null;
    url: string;
  } | null;
};

type IpcOperation = (payload: unknown) => unknown | Promise<unknown>;

export type IpcOperations = Partial<Record<IpcChannel, IpcOperation>>;

const errorMessages: Record<IpcErrorCode, string> = {
  UNKNOWN_CHANNEL: 'Unauthorized request.',
  UNAUTHORIZED: 'Unauthorized request.',
  INVALID_REQUEST: 'Invalid request.',
  NOT_READY: 'Operation is not available.',
  INTERNAL: 'Operation failed.',
};

const failure = (code: IpcErrorCode) => ({
  ok: false as const,
  error: { code, message: errorMessages[code] },
});

const unauthorized = (code: 'UNKNOWN_CHANNEL' | 'UNAUTHORIZED') => failure(code);
const invalidRequest = () => failure('INVALID_REQUEST');
const notReady = () => failure('NOT_READY');
const internalError = () => failure('INTERNAL');

function isIpcChannel(channel: string): channel is IpcChannel {
  return Object.hasOwn(IPC_METHODS, channel);
}

function isTrustedSender(event: IpcSenderEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) {
    return false;
  }

  try {
    const url = new URL(frame.url);
    return (
      url.protocol === 'copilot:' &&
      url.hostname === 'app' &&
      url.port === '' &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

export async function dispatchIpc(
  channel: string,
  event: IpcSenderEvent,
  payload: unknown,
  operations: IpcOperations = {},
): Promise<IpcMethodResponse<IpcChannel>> {
  if (!isIpcChannel(channel)) {
    return unauthorized('UNKNOWN_CHANNEL');
  }
  if (!isTrustedSender(event)) {
    return unauthorized('UNAUTHORIZED');
  }

  const method = IPC_METHODS[channel];
  const request = method.request.safeParse(payload);
  if (!request.success) {
    return invalidRequest();
  }

  try {
    const response = await (operations[channel] ?? notReady)(request.data);
    const parsedResponse = method.response.safeParse(response);
    if (!parsedResponse.success) {
      return internalError();
    }

    return parsedResponse.data.ok ? parsedResponse.data : failure(parsedResponse.data.error.code);
  } catch {
    return internalError();
  }
}

export function registerIpc(operations: IpcOperations = {}): void {
  for (const channel of Object.keys(IPC_METHODS) as IpcChannel[]) {
    ipcMain.handle(channel, (event, payload) => dispatchIpc(channel, event, payload, operations));
  }
}
