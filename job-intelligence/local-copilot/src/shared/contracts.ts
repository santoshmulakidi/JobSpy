import { z } from 'zod';

const NonEmptyId = z.string().min(1);
const NoRequest = z.undefined();

export const StartSessionRequest = z
  .object({
    operationId: NonEmptyId,
    sttProviderId: NonEmptyId,
    llmProviderId: NonEmptyId,
    microphone: z.boolean(),
    systemAudio: z.boolean(),
    ephemeral: z.boolean(),
  })
  .strict();
export const PauseSessionRequest = z.object({ operationId: NonEmptyId }).strict();
export const StopSessionRequest = z.object({ operationId: NonEmptyId }).strict();
export const SessionStatusRequest = NoRequest;

export const ListProvidersRequest = NoRequest;
export const SaveProviderSecretRequest = z
  .object({ providerId: NonEmptyId, secret: z.string().min(1) })
  .strict();

export const PreviewCaptureRequest = z.object({ displayId: NonEmptyId.optional() }).strict();
const ScreenshotRectangle = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();
const ScreenshotEdits = z.object({
  crop: ScreenshotRectangle.optional(),
  redactions: z.array(ScreenshotRectangle).max(20).optional(),
  remove: z.boolean().optional(),
}).strict();
export type ScreenshotRectangleValue = z.infer<typeof ScreenshotRectangle>;
export type ScreenshotEditsValue = z.infer<typeof ScreenshotEdits>;
export const ConfirmCaptureRequest = z.object({ captureId: NonEmptyId, edits: ScreenshotEdits.optional() }).strict();
export const DiscardCaptureRequest = z.object({ captureId: NonEmptyId }).strict();

export const ListHistoryRequest = z.object({ limit: z.number().int().min(1).max(100).optional() }).strict();
const HistorySessionSummary = z.object({
  sessionId: NonEmptyId,
  status: NonEmptyId,
  startedAt: NonEmptyId,
  endedAt: z.string().nullable(),
  turnCount: z.number().int().nonnegative(),
  preview: z.string(),
}).strict();
export type HistorySessionSummaryValue = z.infer<typeof HistorySessionSummary>;
export const DeleteHistoryRequest = z.object({ sessionId: NonEmptyId }).strict();
export const PurgeHistoryRequest = NoRequest;
const DeletionReceipt = z.object({
  sessions: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(),
  screenshots: z.number().int().nonnegative(),
  recordings: z.number().int().nonnegative(),
}).strict();
export type DeletionReceiptValue = z.infer<typeof DeletionReceipt>;
export const ExportHistoryRequest = z
  .object({ sessionId: NonEmptyId, format: z.enum(['json', 'markdown']) })
  .strict();

export const SetOverlayOpacityRequest = z.object({ opacity: z.number().min(0.1).max(1) }).strict();
export const SetOverlayAlwaysOnTopRequest = z.object({ enabled: z.boolean() }).strict();
export const HideOverlayRequest = NoRequest;
export const MoveOverlayRequest = z.object({
  x: z.number().int().min(-100).max(100),
  y: z.number().int().min(-100).max(100),
}).strict();

export const SendAnswerRequest = z.object({
  providerId: NonEmptyId,
  model: NonEmptyId.optional(),
  question: z.string().trim().min(1).max(8_000),
  screenshotId: NonEmptyId.optional(),
}).strict();
export const CancelAnswerRequest = NoRequest;
export const COPILOT_EVENT_CHANNEL = 'copilot:event';
export const CopilotMainEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('transcript-partial'), text: z.string() }).strict(),
  z.object({ type: z.literal('transcript-final'), text: z.string() }).strict(),
  z.object({ type: z.literal('transcript-failed'), message: z.string() }).strict(),
  z.object({ type: z.literal('answer-delta'), text: z.string() }).strict(),
  z.object({
    type: z.literal('answer-completed'),
    model: NonEmptyId,
    latencyMs: z.number().int().nonnegative(),
  }).strict(),
  z.object({ type: z.literal('answer-failed'), message: z.string() }).strict(),
  z.object({ type: z.literal('answer-cancelled') }).strict(),
]);
export type CopilotMainEventValue = z.infer<typeof CopilotMainEvent>;

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

const SessionSnapshot = z.object({
  phase: z.enum(['idle', 'capturing', 'paused', 'generating', 'error', 'stopped']),
  error: z.object({ code: z.enum(['GENERATION_FAILED', 'UTILITY_PROCESS_CRASHED']), message: z.string() }).strict().nullable(),
}).strict();
const SessionCommandSuccess = z.object({ ok: z.literal(true), operationId: NonEmptyId, snapshot: SessionSnapshot }).strict();
export const StartSessionResponse = z.union([SessionCommandSuccess, IpcFailure]);
export const PauseSessionResponse = z.union([SessionCommandSuccess, IpcFailure]);
export const StopSessionResponse = z.union([SessionCommandSuccess, IpcFailure]);
export const SessionStatusResponse = z.union([z.object({ ok: z.literal(true), snapshot: SessionSnapshot }).strict(), IpcFailure]);
const Provider = z.object({
  id: NonEmptyId,
  kind: z.enum(['stt', 'llm']),
  name: NonEmptyId,
  destination: NonEmptyId,
  optional: z.boolean(),
  models: z.array(NonEmptyId).optional(),
  configured: z.boolean(),
}).strict();
export type ProviderValue = z.infer<typeof Provider>;
export const ListProvidersResponse = z.union([z.object({ ok: z.literal(true), providers: z.array(Provider) }).strict(), IpcFailure]);
export const SaveProviderSecretResponse = z.union([
  z.object({
    ok: z.literal(true),
    status: z.object({ providerId: NonEmptyId, configured: z.boolean() }).strict(),
  }).strict(),
  IpcFailure,
]);
const ScreenshotPreview = z.object({
  id: NonEmptyId,
  displayId: NonEmptyId.optional(),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  bytes: z.instanceof(Uint8Array),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
}).strict();
export type ScreenshotPreviewValue = z.infer<typeof ScreenshotPreview>;
const ConfirmedScreenshot = z.object({
  id: NonEmptyId,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  edits: ScreenshotEdits,
}).strict();
export const PreviewCaptureResponse = z.union([z.object({ ok: z.literal(true), preview: ScreenshotPreview }).strict(), IpcFailure]);
export const ConfirmCaptureResponse = z.union([z.object({ ok: z.literal(true), screenshot: ConfirmedScreenshot.optional() }).strict(), IpcFailure]);
export const DiscardCaptureResponse = IpcResponse;
export const ListHistoryResponse = z.union([
  z.object({ ok: z.literal(true), sessions: z.array(HistorySessionSummary) }).strict(),
  IpcFailure,
]);
export const DeleteHistoryResponse = z.union([
  z.object({ ok: z.literal(true), receipt: DeletionReceipt }).strict(),
  IpcFailure,
]);
export const PurgeHistoryResponse = DeleteHistoryResponse;
export const ExportHistoryResponse = z.union([
  z.object({
    ok: z.literal(true),
    filename: NonEmptyId,
    content: z.string(),
  }).strict(),
  IpcFailure,
]);
export const SetOverlayOpacityResponse = IpcResponse;
export const SetOverlayAlwaysOnTopResponse = IpcResponse;
export const HideOverlayResponse = IpcResponse;
export const MoveOverlayResponse = IpcResponse;
export const SendAnswerResponse = IpcResponse;
export const CancelAnswerResponse = IpcResponse;

export const IPC_METHODS = {
  'session:start': { request: StartSessionRequest, response: StartSessionResponse },
  'session:pause': { request: PauseSessionRequest, response: PauseSessionResponse },
  'session:stop': { request: StopSessionRequest, response: StopSessionResponse },
  'session:status': { request: SessionStatusRequest, response: SessionStatusResponse },
  'providers:list': { request: ListProvidersRequest, response: ListProvidersResponse },
  'providers:save-secret': { request: SaveProviderSecretRequest, response: SaveProviderSecretResponse },
  'capture:preview': { request: PreviewCaptureRequest, response: PreviewCaptureResponse },
  'capture:confirm': { request: ConfirmCaptureRequest, response: ConfirmCaptureResponse },
  'capture:discard': { request: DiscardCaptureRequest, response: DiscardCaptureResponse },
  'history:list': { request: ListHistoryRequest, response: ListHistoryResponse },
  'history:delete': { request: DeleteHistoryRequest, response: DeleteHistoryResponse },
  'history:purge': { request: PurgeHistoryRequest, response: PurgeHistoryResponse },
  'history:export': { request: ExportHistoryRequest, response: ExportHistoryResponse },
  'overlay:set-opacity': { request: SetOverlayOpacityRequest, response: SetOverlayOpacityResponse },
  'overlay:set-always-on-top': {
    request: SetOverlayAlwaysOnTopRequest,
    response: SetOverlayAlwaysOnTopResponse,
  },
  'overlay:hide': { request: HideOverlayRequest, response: HideOverlayResponse },
  'overlay:move': { request: MoveOverlayRequest, response: MoveOverlayResponse },
  'answer:send': { request: SendAnswerRequest, response: SendAnswerResponse },
  'answer:cancel': { request: CancelAnswerRequest, response: CancelAnswerResponse },
} as const;

export type IpcChannel = keyof typeof IPC_METHODS;
export type IpcRequest<C extends IpcChannel> = z.input<(typeof IPC_METHODS)[C]['request']>;
export type IpcMethodResponse<C extends IpcChannel> = z.output<(typeof IPC_METHODS)[C]['response']>;
export type SerializedIpcError = z.infer<typeof IpcError>;

export interface CopilotBridge {
  readonly session: {
    start(request: IpcRequest<'session:start'>): Promise<IpcMethodResponse<'session:start'>>;
    pause(request: IpcRequest<'session:pause'>): Promise<IpcMethodResponse<'session:pause'>>;
    stop(request: IpcRequest<'session:stop'>): Promise<IpcMethodResponse<'session:stop'>>;
    status(): Promise<IpcMethodResponse<'session:status'>>;
  };
  readonly providers: {
    list(): Promise<IpcMethodResponse<'providers:list'>>;
    saveSecret(request: IpcRequest<'providers:save-secret'>): Promise<IpcMethodResponse<'providers:save-secret'>>;
  };
  readonly capture: {
    preview(request: IpcRequest<'capture:preview'>): Promise<IpcMethodResponse<'capture:preview'>>;
    confirm(request: IpcRequest<'capture:confirm'>): Promise<IpcMethodResponse<'capture:confirm'>>;
    discard(request: IpcRequest<'capture:discard'>): Promise<IpcMethodResponse<'capture:discard'>>;
  };
  readonly history: {
    list(request: IpcRequest<'history:list'>): Promise<IpcMethodResponse<'history:list'>>;
    remove(request: IpcRequest<'history:delete'>): Promise<IpcMethodResponse<'history:delete'>>;
    purge(): Promise<IpcMethodResponse<'history:purge'>>;
    export(request: IpcRequest<'history:export'>): Promise<IpcMethodResponse<'history:export'>>;
  };
  readonly overlay: {
    setOpacity(request: IpcRequest<'overlay:set-opacity'>): Promise<IpcMethodResponse<'overlay:set-opacity'>>;
    setAlwaysOnTop(request: IpcRequest<'overlay:set-always-on-top'>): Promise<IpcMethodResponse<'overlay:set-always-on-top'>>;
    move(request: IpcRequest<'overlay:move'>): Promise<IpcMethodResponse<'overlay:move'>>;
    hide(): Promise<IpcMethodResponse<'overlay:hide'>>;
  };
  readonly answer?: {
    send(request: IpcRequest<'answer:send'>): Promise<IpcMethodResponse<'answer:send'>>;
    cancel(): Promise<IpcMethodResponse<'answer:cancel'>>;
  };
  readonly onAnswerEvent?: (listener: (event: CopilotMainEventValue) => void) => () => void;
}
