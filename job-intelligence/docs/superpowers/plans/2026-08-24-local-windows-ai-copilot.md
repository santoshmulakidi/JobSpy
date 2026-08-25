# Local Windows AI Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a signed Windows Electron desktop copilot that captures authorized system/microphone audio, streams transcription, optionally attaches approved screenshots, and streams BYOK AI answers into a secure local overlay.

**Architecture:** A sandboxed React renderer communicates through a narrow typed preload bridge to an Electron main process. A utility process owns audio processing, provider adapters normalize STT/LLM streaming, SQLite stores nonsecret local history, and Electron `safeStorage` protects user keys.

**Tech Stack:** Electron 43, React, TypeScript, Vite, Zod, Vitest, Playwright Electron, SQLite, Electron Forge, Deepgram WebSocket API, ElevenLabs Realtime STT, Gemini, OpenAI, Anthropic, and OpenRouter.

## Global Constraints

- Windows 10/11 x64 first; separate product/repository.
- No application backend, account, subscription, analytics, or telemetry.
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` for every renderer.
- Raw audio and screenshots are memory-only by default.
- Secrets remain in the main process and are stored with Electron `safeStorage`.
- Renderer assets are local; remote navigation and arbitrary IPC are prohibited.
- Provider changes and data-destination changes are explicit, never silent.
- Capture exclusion is best effort and must not be marketed as guaranteed invisibility.
- Use TDD, small focused files, a locked dependency graph, and frequent commits.

---

## Planned repository map

```text
local-copilot/
├── package.json
├── forge.config.ts
├── vite.main.config.ts
├── vite.preload.config.ts
├── vite.renderer.config.ts
├── src/
│   ├── main/
│   │   ├── bootstrap.ts
│   │   ├── windows/overlay-window.ts
│   │   ├── ipc/register-ipc.ts
│   │   ├── security/navigation-policy.ts
│   │   ├── security/network-policy.ts
│   │   ├── storage/database.ts
│   │   ├── storage/secrets.ts
│   │   ├── sessions/session-controller.ts
│   │   ├── capture/screenshot-service.ts
│   │   └── providers/provider-registry.ts
│   ├── preload/index.ts
│   ├── renderer/
│   │   ├── app.tsx
│   │   ├── features/session/
│   │   ├── features/settings/
│   │   ├── features/history/
│   │   └── styles/tokens.css
│   ├── audio/
│   │   ├── utility-entry.ts
│   │   ├── audio-frame.ts
│   │   ├── capture-controller.ts
│   │   └── vad.ts
│   ├── providers/
│   │   ├── stt/types.ts
│   │   ├── stt/deepgram.ts
│   │   ├── stt/elevenlabs.ts
│   │   ├── llm/types.ts
│   │   ├── llm/gemini.ts
│   │   ├── llm/openai.ts
│   │   ├── llm/anthropic.ts
│   │   └── llm/openrouter.ts
│   ├── context/context-engine.ts
│   └── shared/contracts.ts
├── tests/
│   ├── unit/
│   ├── contract/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
└── docs/
    ├── architecture.md
    ├── privacy.md
    └── threat-model.md
```

### Task 1: Secure Electron shell and repository baseline

**Files:**
- Create: `package.json`
- Create: `forge.config.ts`
- Create: `src/main/bootstrap.ts`
- Create: `src/main/windows/overlay-window.ts`
- Create: `src/main/security/navigation-policy.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/app.tsx`
- Test: `tests/integration/window-security.test.ts`

**Interfaces:**
- Produces: `createOverlayWindow(): BrowserWindow`, `installNavigationPolicy(window): void`.

- [ ] **Step 1: Scaffold the locked TypeScript Electron project with Electron 43, React, Vite, Vitest, Zod, Playwright, and Electron Forge.**

```json
{
  "name": "local-windows-ai-copilot",
  "private": true,
  "version": "0.1.0",
  "main": ".vite/build/main.js",
  "scripts": {
    "start": "electron-forge start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "package": "electron-forge package",
    "make": "electron-forge make"
  }
}
```

- [ ] **Step 2: Write the failing packaged-window security test.**

```ts
expect(prefs.nodeIntegration).toBe(false);
expect(prefs.contextIsolation).toBe(true);
expect(prefs.sandbox).toBe(true);
```

- [ ] **Step 3: Run `npm test -- window-security` and verify it fails because no window factory exists.**
- [ ] **Step 4: Implement `app.enableSandbox()`, a local custom protocol, strict BrowserWindow preferences, CSP, blocked navigation, and denied new windows.**
- [ ] **Step 5: Run `npm run typecheck && npm test -- window-security`; expect both to pass.**
- [ ] **Step 6: Commit with `git commit -am "feat: establish secure Electron shell"`.**

### Task 2: Typed preload bridge and IPC authorization

**Files:**
- Create: `src/shared/contracts.ts`
- Create: `src/main/ipc/register-ipc.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/integration/ipc-boundary.test.ts`

**Interfaces:**
- Produces: `window.copilot.session`, `window.copilot.providers`, `window.copilot.capture`, `window.copilot.history`, and `window.copilot.overlay`.

- [ ] **Step 1: Define Zod request/response schemas and TypeScript inference for every MVP IPC method.**

```ts
export const StartSessionRequest = z.object({
  sttProviderId: z.string().min(1),
  llmProviderId: z.string().min(1),
  microphone: z.boolean(),
  systemAudio: z.boolean(),
  ephemeral: z.boolean()
});
```

- [ ] **Step 2: Write failing tests proving unknown channels, invalid payloads, and non-main-frame senders are rejected.**
- [ ] **Step 3: Run `npm test -- ipc-boundary`; expect rejection assertions to fail.**
- [ ] **Step 4: Implement one function per bridge method; do not expose raw `ipcRenderer.send` or `invoke`.**
- [ ] **Step 5: Add sender-frame/origin validation and structured error serialization.**
- [ ] **Step 6: Run typecheck and IPC tests; expect all to pass.**
- [ ] **Step 7: Commit with `git commit -am "feat: add authorized typed IPC bridge"`.**

### Task 3: SQLite migrations and DPAPI-backed secrets

**Files:**
- Create: `src/main/storage/database.ts`
- Create: `src/main/storage/migrations/001-initial.sql`
- Create: `src/main/storage/secrets.ts`
- Test: `tests/integration/storage.test.ts`

**Interfaces:**
- Produces: `Database.open(path)`, `SecretStore.save(providerId, secret)`, `SecretStore.withSecret(providerId, fn)`, and `SecretStore.delete(providerId)`.

- [ ] **Step 1: Write failing tests for migrations, transactions, secret round-trip, masked status, replacement, and deletion.**
- [ ] **Step 2: Assert that a synthetic secret never appears in SQLite bytes or returned renderer DTOs.**
- [ ] **Step 3: Run `npm test -- storage`; expect failure before implementation.**
- [ ] **Step 4: Implement WAL-mode SQLite access and the initial schema from the architecture document.**
- [ ] **Step 5: Implement `safeStorage` encryption with opaque secret references; fail closed when encryption is unavailable.**
- [ ] **Step 6: Run storage tests and a raw-file secret scan; expect pass and zero matches.**
- [ ] **Step 7: Commit with `git commit -am "feat: add local database and protected secrets"`.**

### Task 4: Session state machine and cancellation

**Files:**
- Create: `src/main/sessions/session-state.ts`
- Create: `src/main/sessions/session-controller.ts`
- Test: `tests/unit/session-controller.test.ts`

**Interfaces:**
- Produces: `SessionController.dispatch(intent): SessionSnapshot` and `SessionController.events(): AsyncIterable<SessionEvent>`.

- [ ] **Step 1: Encode the approved states and allowed transitions as a total transition function.**
- [ ] **Step 2: Write failing tests for duplicate start, pause/resume, superseding generation, stop-from-error, and utility-process crash.**
- [ ] **Step 3: Run `npm test -- session-controller`; expect transition failures.**
- [ ] **Step 4: Implement the controller with one AbortController per capture and generation lifecycle.**
- [ ] **Step 5: Verify stop clears pending buffers and emits one terminal event.**
- [ ] **Step 6: Commit with `git commit -am "feat: add deterministic session lifecycle"`.**

### Task 5: Audio utility process, capture, resampling, and VAD

**Files:**
- Create: `src/audio/utility-entry.ts`
- Create: `src/audio/audio-frame.ts`
- Create: `src/audio/capture-controller.ts`
- Create: `src/audio/resampler.ts`
- Create: `src/audio/vad.ts`
- Test: `tests/unit/audio-pipeline.test.ts`
- Test: `tests/integration/audio-utility.test.ts`
- Create: `tests/fixtures/audio/question-24k-mono.pcm`

**Interfaces:**
- Produces: `AudioFrame { source, sequence, capturedAt, sampleRate, channels, pcm }`, `CaptureController.start(config)`, `CaptureController.frames()`, and `VadDetector.accept(frame)`.

- [ ] **Step 1: Add deterministic PCM fixtures containing silence, one question, pauses, and overlapping source timestamps.**
- [ ] **Step 2: Write failing tests for sequence order, resampling, bounded buffering, VAD boundaries, source loss, and memory-only default.**
- [ ] **Step 3: Run `npm test -- audio`; expect failure.**
- [ ] **Step 4: Implement Windows system-loopback and microphone acquisition through Electron display media plus the isolated utility process.**
- [ ] **Step 5: Implement resampling, jitter bounds, VAD, and explicit zero/release on stop.**
- [ ] **Step 6: Run unit/integration tests and verify no recording file is created.**
- [ ] **Step 7: Commit with `git commit -am "feat: add isolated low-latency audio pipeline"`.**

### Task 6: Streaming transcription adapters

**Files:**
- Create: `src/providers/stt/types.ts`
- Create: `src/providers/stt/deepgram.ts`
- Create: `src/providers/stt/elevenlabs.ts`
- Test: `tests/contract/stt-adapters.test.ts`

**Interfaces:**
- Produces: `TranscriptionAdapter.connect`, `sendAudio`, `events`, and `close`; normalized `TranscriptEvent` union.

- [ ] **Step 1: Write a shared fake WebSocket server and adapter contract suite.**
- [ ] **Step 2: Cover partial, committed, speech boundary, malformed event, quota error, close, cancellation, and reconnect.**
- [ ] **Step 3: Run `npm test -- stt-adapters`; expect failure.**
- [ ] **Step 4: Implement Deepgram Nova streaming with endpointing and utterance-end normalization.**
- [ ] **Step 5: Implement ElevenLabs Scribe v2 Realtime with provider-specific authentication and event mapping.**
- [ ] **Step 6: Run contract tests; expect both adapters to pass the identical suite.**
- [ ] **Step 7: Commit with `git commit -am "feat: add streaming transcription adapters"`.**

### Task 7: Provider-neutral LLM streaming

**Files:**
- Create: `src/providers/llm/types.ts`
- Create: `src/providers/llm/gemini.ts`
- Create: `src/providers/llm/openai.ts`
- Create: `src/providers/llm/anthropic.ts`
- Create: `src/providers/llm/openrouter.ts`
- Create: `src/main/providers/provider-registry.ts`
- Test: `tests/contract/llm-adapters.test.ts`

**Interfaces:**
- Produces: `LlmAdapter.validate(config)`, `LlmAdapter.stream(request, signal)`, `CopilotRequest`, `ModelCapability`, and normalized `LlmEvent`.

- [ ] **Step 1: Write provider-agnostic contract fixtures for text, images, cancellation, authentication failure, rate limit, timeout, unknown completion, and usage.**
- [ ] **Step 2: Run `npm test -- llm-adapters`; expect all adapters missing.**
- [ ] **Step 3: Implement Gemini GenerateContent streaming.**
- [ ] **Step 4: Implement OpenAI Responses streaming.**
- [ ] **Step 5: Implement Anthropic Messages streaming.**
- [ ] **Step 6: Implement OpenRouter through its documented OpenAI-compatible endpoint while preserving OpenRouter model IDs.**
- [ ] **Step 7: Enforce provider-specific host allowlists and off-allowlist redirect rejection.**
- [ ] **Step 8: Run contract and network-policy tests; expect pass.**
- [ ] **Step 9: Commit with `git commit -am "feat: add BYOK LLM provider adapters"`.**

### Task 8: Context engine and answer formatter

**Files:**
- Create: `src/context/context-engine.ts`
- Create: `src/context/token-budget.ts`
- Create: `src/renderer/features/session/streaming-markdown.tsx`
- Test: `tests/unit/context-engine.test.ts`
- Test: `tests/unit/streaming-markdown.test.tsx`

**Interfaces:**
- Produces: `buildCopilotRequest(input): CopilotRequest` and `StreamingMarkdown`.

- [ ] **Step 1: Write failing tests proving current question/system constraints survive trimming while oldest history is removed first.**
- [ ] **Step 2: Add adversarial transcript and Markdown fixtures containing instruction injection, raw HTML, dangerous URLs, and broken code fences.**
- [ ] **Step 3: Run context/renderer tests; expect failure.**
- [ ] **Step 4: Implement deterministic context assembly and attachment manifests.**
- [ ] **Step 5: Implement sanitized incremental Markdown with local syntax highlighting and no executable HTML.**
- [ ] **Step 6: Run tests; expect all adversarial fixtures to render inertly.**
- [ ] **Step 7: Commit with `git commit -am "feat: add bounded context and safe streaming answers"`.**

### Task 9: Screenshot service and overlay controls

**Files:**
- Create: `src/main/capture/screenshot-service.ts`
- Modify: `src/main/windows/overlay-window.ts`
- Create: `src/renderer/features/session/screenshot-preview.tsx`
- Test: `tests/integration/screenshot-service.test.ts`
- Test: `tests/e2e/overlay-controls.spec.ts`

**Interfaces:**
- Produces: `ScreenshotService.preview(displayId)`, `confirm(previewId, edits)`, `discard(previewId)`, and overlay setters.

- [ ] **Step 1: Write failing tests for explicit preview, bounded count of five, discard, timeout cleanup, and no disk writes.**
- [ ] **Step 2: Write overlay tests for opacity, click-through, always-on-top, hide, capture protection, and multi-monitor containment.**
- [ ] **Step 3: Implement best-effort `setContentProtection`, compositor-safe hide fallback, and in-memory preview handles.**
- [ ] **Step 4: Implement crop/remove/redact confirmation UI and buffer cleanup after request completion.**
- [ ] **Step 5: Run integration/E2E tests on Windows; classify capture exclusion rather than asserting universal invisibility.**
- [ ] **Step 6: Commit with `git commit -am "feat: add approved screenshots and overlay controls"`.**

### Task 10: Session UI, onboarding, settings, and shortcuts

**Files:**
- Modify: `src/renderer/app.tsx`
- Create: `src/renderer/features/settings/provider-setup.tsx`
- Create: `src/renderer/features/session/session-view.tsx`
- Create: `src/renderer/features/session/transcript-panel.tsx`
- Create: `src/renderer/features/session/answer-panel.tsx`
- Create: `src/renderer/styles/tokens.css`
- Test: `tests/e2e/user-journeys.spec.ts`

**Interfaces:**
- Consumes: typed preload bridge and session/provider events.
- Produces: complete MVP user workflow.

- [ ] **Step 1: Write E2E tests for onboarding, provider validation, session start/pause/resume/stop, edit-before-send, screenshot approval, cancel, retry, and shortcut conflict.**
- [ ] **Step 2: Run the user-journey suite; expect failure.**
- [ ] **Step 3: Implement keyboard-first onboarding and provider destination disclosures.**
- [ ] **Step 4: Implement transcript, answer, capture-state, model, latency, and error surfaces.**
- [ ] **Step 5: Implement theme, opacity, font, movement, resize, click-through, and instant-hide controls.**
- [ ] **Step 6: Run E2E and accessibility checks; expect pass with visible focus and scalable text.**
- [ ] **Step 7: Commit with `git commit -am "feat: complete local copilot session experience"`.**

### Task 11: History, export, recording opt-in, deletion, and diagnostics

**Files:**
- Create: `src/main/history/history-service.ts`
- Create: `src/main/history/export-service.ts`
- Create: `src/audio/recording-writer.ts`
- Create: `src/main/diagnostics/diagnostic-log.ts`
- Create: `src/renderer/features/history/history-view.tsx`
- Test: `tests/integration/privacy-lifecycle.test.ts`

**Interfaces:**
- Produces: local history/search, Markdown/JSON export, explicit recording, deterministic deletion, and redacted support bundle.

- [ ] **Step 1: Write failing tests for default no-recording, ephemeral sessions, opt-in recording metadata, per-session deletion, complete purge, and redacted diagnostics.**
- [ ] **Step 2: Include synthetic API keys, PII, transcripts, answers, and screenshot bytes in the test session.**
- [ ] **Step 3: Run `npm test -- privacy-lifecycle`; expect failure.**
- [ ] **Step 4: Implement transactional history and explicit recording writer with a user-selected folder.**
- [ ] **Step 5: Implement Markdown/JSON export and deletion receipts containing counts only.**
- [ ] **Step 6: Implement rolling 14-day structured diagnostics with content redaction.**
- [ ] **Step 7: Scan DB, logs, and support bundle; expect no synthetic keys/content.**
- [ ] **Step 8: Commit with `git commit -am "feat: add private history and deterministic deletion"`.**

### Task 12: Packaging, signing, update verification, and release qualification

**Files:**
- Modify: `forge.config.ts`
- Create: `scripts/audit-packaged-security.mjs`
- Create: `scripts/generate-sbom.mjs`
- Create: `.github/workflows/windows-release.yml`
- Create: `docs/release-checklist.md`
- Test: `tests/integration/update-verification.test.ts`

**Interfaces:**
- Produces: signed installer, signed update metadata, hashes, SBOM, and release evidence.

- [ ] **Step 1: Write a failing packaged-security audit for Electron version, fuses, renderer flags, CSP, navigation policy, and source-map/secret leakage.**
- [ ] **Step 2: Write update tests that reject a modified package and an untrusted manifest signer.**
- [ ] **Step 3: Configure Windows code signing from protected CI secrets and generate SHA-256 checksums.**
- [ ] **Step 4: Generate CycloneDX SBOM and dependency audit outputs.**
- [ ] **Step 5: Run typecheck, all tests, package, security audit, installer clean-install, upgrade, and four-hour synthetic-audio soak.**
- [ ] **Step 6: Verify the default-session filesystem contains no audio or screenshots.**
- [ ] **Step 7: Publish release evidence and commit with `git commit -am "build: qualify signed Windows MVP release"`.**

## Plan self-review

- Spec coverage: every BRD MVP requirement maps to Tasks 1-12.
- Scope: macOS, cloud accounts, billing, telemetry, remote administration, and second-device sync remain excluded.
- Completeness: every plan step is concrete and executable.
- Type consistency: session, STT, LLM, context, screenshot, history, and secret contracts have one named owner.
- Security: renderer isolation, IPC validation, secret storage, network allowlisting, signing, and update verification are release gates.
- Privacy: default no-recording, screenshot approval, ephemeral mode, deletion, and diagnostic redaction are directly tested.
