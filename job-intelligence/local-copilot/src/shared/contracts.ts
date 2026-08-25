import { z } from 'zod';

const NonEmptyId = z.string().min(1);
const NoRequest = z.undefined();

export const StartSessionRequest = z
  .object({
    sttProviderId: NonEmptyId,
    llmProviderId: NonEmptyId,
    microphone: z.boolean(),
    systemAudio: z.boolean(),
    ephemeral: z.boolean(),
  })
  .strict();
export const PauseSessionRequest = NoRequest;
export const StopSessionRequest = NoRequest;
export const SessionStatusRequest = NoRequest;

export const ListProvidersRequest = NoRequest;
export const TestProviderRequest = z.object({ providerId: NonEmptyId }).strict();
export const SaveProviderSecretRequest = z
  .object({ providerId: NonEmptyId, secret: z.string().min(1) })
  .strict();

export const PreviewCaptureRequest = z.object({ displayId: NonEmptyId.optional() }).strict();
export const ConfirmCaptureRequest = z.object({ captureId: NonEmptyId }).strict();
export const DiscardCaptureRequest = z.object({ captureId: NonEmptyId }).strict();

export const ListHistoryRequest = z
  .object({ limit: z.number().int().min(1).max(100).optional() })
  .strict();
export const GetHistoryRequest = z.object({ sessionId: NonEmptyId }).strict();
export const DeleteHistoryRequest = z.object({ sessionId: NonEmptyId }).strict();
export const ExportHistoryRequest = z
  .object({ sessionId: NonEmptyId, format: z.enum(['json', 'markdown']) })
  .strict();

export const SetOverlayOpacityRequest = z.object({ opacity: z.number().min(0.1).max(1) }).strict();
export const SetOverlayClickThroughRequest = z.object({ enabled: z.boolean() }).strict();
export const HideOverlayRequest = NoRequest;

export const IpcErrorCode = z.enum([
  'UNKNOWN_CHANNEL',
  'UNAUTHORIZED',
  'INVALID_REQUEST',
  'NOT_READY',
  'INTERNAL',
]);
export type IpcErrorCode = z.infer<typeof IpcErrorCode>;
export const IpcError = z
  .object({
    code: IpcErrorCode,
    message: z.string(),
  })
  .strict();
export const IpcFailure = z.object({ ok: z.literal(false), error: IpcError }).strict();
export const IpcSuccess = z.object({ ok: z.literal(true) }).strict();
export const IpcResponse = z.union([IpcSuccess, IpcFailure]);

export const StartSessionResponse = IpcResponse;
export const PauseSessionResponse = IpcResponse;
export const StopSessionResponse = IpcResponse;
export const SessionStatusResponse = IpcResponse;
export const ListProvidersResponse = IpcResponse;
export const TestProviderResponse = IpcResponse;
export const SaveProviderSecretResponse = IpcResponse;
export const PreviewCaptureResponse = IpcResponse;
export const ConfirmCaptureResponse = IpcResponse;
export const DiscardCaptureResponse = IpcResponse;
export const ListHistoryResponse = IpcResponse;
export const GetHistoryResponse = IpcResponse;
export const DeleteHistoryResponse = IpcResponse;
export const ExportHistoryResponse = IpcResponse;
export const SetOverlayOpacityResponse = IpcResponse;
export const SetOverlayClickThroughResponse = IpcResponse;
export const HideOverlayResponse = IpcResponse;

export const IPC_METHODS = {
  'session:start': { request: StartSessionRequest, response: StartSessionResponse },
  'session:pause': { request: PauseSessionRequest, response: PauseSessionResponse },
  'session:stop': { request: StopSessionRequest, response: StopSessionResponse },
  'session:status': { request: SessionStatusRequest, response: SessionStatusResponse },
  'providers:list': { request: ListProvidersRequest, response: ListProvidersResponse },
  'providers:test': { request: TestProviderRequest, response: TestProviderResponse },
  'providers:save-secret': { request: SaveProviderSecretRequest, response: SaveProviderSecretResponse },
  'capture:preview': { request: PreviewCaptureRequest, response: PreviewCaptureResponse },
  'capture:confirm': { request: ConfirmCaptureRequest, response: ConfirmCaptureResponse },
  'capture:discard': { request: DiscardCaptureRequest, response: DiscardCaptureResponse },
  'history:list': { request: ListHistoryRequest, response: ListHistoryResponse },
  'history:get': { request: GetHistoryRequest, response: GetHistoryResponse },
  'history:delete': { request: DeleteHistoryRequest, response: DeleteHistoryResponse },
  'history:export': { request: ExportHistoryRequest, response: ExportHistoryResponse },
  'overlay:set-opacity': { request: SetOverlayOpacityRequest, response: SetOverlayOpacityResponse },
  'overlay:set-click-through': {
    request: SetOverlayClickThroughRequest,
    response: SetOverlayClickThroughResponse,
  },
  'overlay:hide': { request: HideOverlayRequest, response: HideOverlayResponse },
} as const;

export type IpcChannel = keyof typeof IPC_METHODS;
export type IpcRequest<C extends IpcChannel> = z.input<(typeof IPC_METHODS)[C]['request']>;
export type IpcMethodResponse<C extends IpcChannel> = z.output<(typeof IPC_METHODS)[C]['response']>;
export type SerializedIpcError = z.infer<typeof IpcError>;
