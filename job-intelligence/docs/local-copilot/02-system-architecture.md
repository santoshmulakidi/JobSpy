# Local Windows AI Copilot - System Architecture

## 1. Architectural drivers

- Windows-first desktop capture.
- Electron and React for delivery speed and UI flexibility.
- Local-first operation with user-supplied provider keys.
- No product backend in the MVP.
- Strict isolation between web-rendered UI and privileged operating-system capabilities.
- Low-latency streaming for audio, transcripts, and answers.
- Replaceable transcription and LLM adapters.
- Best-effort overlay capture exclusion without misleading guarantees.

## 2. Technology baseline

| Layer | Choice |
|---|---|
| Desktop shell | A currently supported Electron major; baseline Electron 43 at design time |
| UI | React, TypeScript, Vite, CSS variables/design tokens |
| State | Reducer/state-machine architecture; no secrets in renderer state |
| Validation | Zod schemas shared across preload and main process |
| Storage | SQLite with migrations; WAL mode; encrypted secret references only |
| Secrets | Electron `safeStorage` backed by Windows DPAPI |
| Audio | Electron loopback capture plus a dedicated utility process/worker |
| Images | Electron desktop capture/Windows Graphics Capture integration |
| Networking | Main/utility processes only; HTTPS/WSS allowlist |
| Packaging | Electron Forge or Electron Builder with signed MSI/NSIS installer |
| Testing | Vitest, Playwright Electron, contract tests, audio fixtures, Windows VM matrix |

Electron's current guidance requires Node integration to remain disabled, context isolation and sandboxing to remain enabled, a restrictive CSP, sender validation for IPC, and blocked untrusted navigation. These requirements are architectural invariants rather than optional hardening tasks.

## 3. Process model

```text
┌─────────────────────────────────────────────────────────────┐
│ Electron main process                                       │
│ Window manager | IPC router | secrets | DB | network policy │
└───────────────┬───────────────────────┬─────────────────────┘
                │ typed IPC             │ message ports
        ┌───────▼────────┐      ┌───────▼──────────────────┐
        │ Preload bridge │      │ Audio utility process    │
        │ allowlisted API│      │ capture/resample/VAD     │
        └───────┬────────┘      └───────┬──────────────────┘
                │                       │ bounded PCM frames
        ┌───────▼────────┐      ┌───────▼──────────────────┐
        │ React renderer │      │ Provider orchestration   │
        │ local UI only  │      │ STT + LLM + cancellation │
        └────────────────┘      └──────────────────────────┘
```

### 3.1 Main process

Responsibilities:

- Create and govern all windows.
- Register global shortcuts.
- Enforce navigation, new-window, permission, and outbound-host policies.
- Own SQLite connections and migrations.
- Encrypt/decrypt provider keys.
- Create provider clients using secret handles.
- Start/stop the audio utility process.
- Coordinate screenshots and capture exclusion.
- Manage session state, cancellation, export, and deletion.
- Verify signed updates.

The main process shall not parse arbitrary HTML, execute remotely supplied scripts, or expose generic filesystem/shell IPC.

### 3.2 Preload bridge

The preload exposes small namespaces such as:

- `session.start`, `session.pause`, `session.stop`, `session.status`.
- `audio.listDevices`, `audio.configure`, `audio.levels`.
- `capture.preview`, `capture.confirm`, `capture.discard`.
- `providers.list`, `providers.test`, `providers.saveSecret`.
- `history.list`, `history.get`, `history.delete`, `history.export`.
- `window.setOpacity`, `window.setClickThrough`, `window.hide`.

Every call uses schema validation, checks the sender frame and origin, and returns serializable data. Generic `send(channel, payload)`, `invoke(channel, payload)`, raw Electron objects, Buffers containing secrets, and file paths outside approved export flows are prohibited.

### 3.3 Renderer

The renderer loads only packaged local assets through a custom application protocol. It renders:

- Onboarding and provider setup.
- Live transcript and answer views.
- Screenshot preview/approval.
- Prompt and session settings.
- Local history and export controls.
- Diagnostics without content bodies.

The renderer receives masked credential status, never secret material.

### 3.4 Audio utility process

Audio work is isolated so provider or DSP load cannot freeze the overlay. Responsibilities:

- Acquire system loopback and microphone streams.
- Normalize sample formats and timestamps.
- Apply optional echo/noise controls appropriate to each source.
- Maintain a bounded jitter buffer.
- Mix or route sources according to provider capabilities.
- Run VAD and emit speech-boundary events.
- Stream PCM frames to the active transcription adapter.
- Optionally tee frames to an encrypted/local recording writer when explicitly enabled.

The process has no access to LLM keys, SQLite, exports, or the renderer.

## 4. Domain modules

### 4.1 Session controller

Canonical states:

```text
IDLE
  → PERMISSION_CHECK
  → CONNECTING
  → LISTENING
  → QUESTION_READY
  → ASSEMBLING_CONTEXT
  → GENERATING
  → LISTENING

Any active state → PAUSED | RECOVERING | CANCELLING | ERROR | STOPPING
STOPPING → IDLE
```

Only the session controller may transition state. UI commands become intents; provider and audio events become observations. This prevents multiple overlapping starts, orphaned streams, and inconsistent capture indicators.

### 4.2 Transcription contract

```ts
interface TranscriptionAdapter {
  connect(config: SttSessionConfig, signal: AbortSignal): Promise<void>;
  sendAudio(frame: AudioFrame): Promise<void>;
  events(): AsyncIterable<TranscriptEvent>;
  close(reason: CloseReason): Promise<void>;
}
```

Normalized events include `connected`, `partial`, `committed`, `speechStart`, `speechEnd`, `usage`, `warning`, `error`, and `closed`.

MVP adapters:

- Deepgram Nova streaming.
- ElevenLabs Scribe v2 Realtime.

Planned adapters:

- OpenAI transcription/realtime.
- Local whisper.cpp.

### 4.3 LLM contract

```ts
interface LlmAdapter {
  validate(config: ProviderConfig): Promise<ModelCapability[]>;
  stream(request: CopilotRequest, signal: AbortSignal): AsyncIterable<LlmEvent>;
}
```

Normalized events include `requestAccepted`, `textDelta`, `reasoningStatus`, `citation`, `usage`, `completed`, and `failed`.

MVP adapters:

- Gemini GenerateContent.
- OpenAI Responses.
- Anthropic Messages.
- OpenRouter OpenAI-compatible chat/responses route.

Provider-specific options are encapsulated in adapter configuration; the renderer works with shared capability flags.

### 4.4 Context engine

Inputs:

- Current committed question.
- User-edited transcript.
- Recent turns within a token budget.
- Active prompt profile.
- Optional local candidate/job context.
- User-approved screenshot attachments.
- Requested answer length and output language.

Processing:

1. Reject empty or unauthorized inputs.
2. Normalize transcript and remove duplicate interim text.
3. Select bounded history using recency and semantic role, not unlimited concatenation.
4. Add a machine-readable attachment manifest.
5. Calculate estimated input budget against the selected model.
6. Trim oldest context before system requirements or the current question.
7. Emit a request summary for the UI.

### 4.5 Screenshot service

- Enumerate displays without exposing raw handles to the renderer.
- Capture only after a user/session policy allows it.
- Apply best-effort content protection to the overlay.
- If exclusion is unsupported, temporarily hide the overlay and wait for compositor settlement.
- Produce an in-memory preview.
- Allow crop/remove/redact before confirmation.
- Downscale and encode within provider limits.
- Delete original and encoded buffers after request completion.

### 4.6 Answer formatter

- Incrementally parse Markdown without executing HTML.
- Sanitize links and block remote image loading.
- Apply syntax highlighting locally.
- Preserve partial code fences during streaming.
- Offer concise, expanded, code-first, and talking-point render modes.
- Never execute generated code.

## 5. Data architecture

### 5.1 SQLite entities

| Entity | Purpose |
|---|---|
| `schema_migrations` | Ordered database versions |
| `app_settings` | Nonsecret application preferences |
| `provider_configs` | Provider IDs, enabled models, secret reference IDs |
| `prompt_profiles` | Built-in clone references and custom prompts |
| `sessions` | Start/end, profile, capture configuration, status |
| `transcript_segments` | Timestamped committed transcript text |
| `turns` | User/model turns, provider/model, status, latency |
| `attachments` | Metadata and optional approved local file references |
| `recordings` | Explicit opt-in recording metadata only |
| `diagnostic_events` | Redacted structured events |

Secret values are excluded from SQLite. Screenshot bytes are memory-only unless the user explicitly saves or exports them.

### 5.2 Retention

- Audio: memory-only by default.
- Transcript/answers: local history enabled by default, with onboarding disclosure and an option for ephemeral sessions.
- Screenshots: memory-only by default.
- Diagnostics: rolling 14-day local redacted log.
- Opt-in recordings: user-selected folder and retention; never silently deleted while a user expects archival.

## 6. Network architecture

The application has no product backend. Main-process networking uses an allowlist generated from enabled adapters:

- Google Gemini endpoints.
- OpenAI endpoints.
- Anthropic endpoints.
- OpenRouter endpoints.
- Deepgram WSS/API endpoints.
- ElevenLabs WSS/API endpoints.
- Signed update host, if automatic updates are enabled.

Redirects are rejected when the destination leaves the allowlist. Proxy support is explicit and disabled by default. Provider keys are injected into request headers only in the privileged process and immediately discarded after client construction/request completion.

## 7. Overlay design

The overlay is a transparent local BrowserWindow with:

- `frame: false`.
- `transparent: true`.
- `alwaysOnTop` controlled by the user.
- `skipTaskbar` controlled by session/view.
- `setIgnoreMouseEvents` for click-through mode.
- `setContentProtection` for best-effort capture exclusion.
- Strict min/max geometry and multi-monitor containment.

The renderer shall display capture status when interactive. Instant hide must stop focus acquisition and remove the window from view, but it does not stop audio capture unless the user binds a separate pause action.

## 8. Error handling

- Use typed error codes independent of provider messages.
- Retry only idempotent connection/warmup operations.
- Never automatically retry a potentially billed answer request after an unknown outcome.
- Cap exponential backoff and provide cancel controls.
- Preserve a committed transcript if answer generation fails.
- Do not switch providers without explicit configuration.
- Degrade screenshot requests to text-only only after user confirmation.
- On utility-process crash, stop capture, clear buffers, and transition to `ERROR`.

## 9. Observability

Structured events contain timestamps, subsystem, state transition, provider/model ID, request ID, latency, byte counts, token usage, and normalized error classification. They exclude transcript bodies, answers, screenshots, authorization material, and raw provider responses.

## 10. Packaging and updates

- Build reproducibly in CI from a locked dependency graph.
- Generate an SBOM and dependency-vulnerability report.
- Sign executable, installer, and update artifacts.
- Verify update signature before replacement.
- Publish SHA-256 hashes and release notes.
- Provide a manual-update channel for users who disable network update checks.

