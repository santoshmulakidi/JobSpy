import WebSocket from 'ws';

import type { SttWebSocket, WebSocketFactory } from '../../providers/stt/types';

const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Node-side WebSocket factory for the main process; supports provider auth headers. */
export function createNodeWebSocketFactory(): WebSocketFactory {
  return ({ url, headers }) => new WebSocket(url, {
    headers: { ...headers },
    handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
  }) as unknown as SttWebSocket;
}
