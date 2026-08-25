# Local Windows AI Copilot Design

## Decision summary

Create a separate Windows-first desktop product using Electron, React, and TypeScript. It will run without a product backend, require user-supplied provider keys, keep raw audio in memory by default, support optional screenshots, and stream answers into a configurable overlay.

## Approved decisions

- Windows first.
- Separate product/repository.
- Electron + React rather than .NET or Tauri.
- Completely local product control plane with BYOK.
- System audio, optional microphone, transcription, screenshots, and streaming answers in the MVP.
- Gemini, OpenAI, Anthropic, and OpenRouter LLM adapters.
- Deepgram and ElevenLabs speech-to-text adapters.
- Raw audio is memory-only by default; recording is explicit opt-in.
- Best-effort capture exclusion is supported but not described as guaranteed invisibility.

## Design artifacts

- `docs/local-copilot/00-research-dossier.md`
- `docs/local-copilot/01-business-requirements-document.md`
- `docs/local-copilot/02-system-architecture.md`
- `docs/local-copilot/03-security-privacy-threat-model.md`
- `docs/local-copilot/04-test-and-validation-strategy.md`

## Architecture

The Electron main process owns windows, secrets, local storage, provider networking, capture orchestration, exports, and updates. A dedicated utility process handles audio acquisition, resampling, VAD, and streaming. The React renderer is sandboxed and communicates only through a typed, schema-validated preload bridge.

The application uses a session state machine to prevent overlapping capture and AI lifecycles. Provider adapters implement normalized streaming contracts. A context engine combines committed transcript segments, prompt profiles, bounded history, and user-approved screenshots. SQLite stores nonsecret settings and local history; Windows DPAPI-backed `safeStorage` protects API keys.

## Error handling

Operations use typed errors and cancellation. Connection/warmup steps may use bounded retries. Answer requests are not repeated after an unknown billed outcome. The application does not silently change providers. Utility-process failure stops capture and clears buffers before reporting an actionable error.

## Security and privacy

All renderers use sandboxing, context isolation, no Node integration, strict CSP, blocked navigation, denied-by-default permissions, validated IPC senders, and no raw Electron API exposure. The main process enforces outbound-host allowlists and keeps secrets out of renderer state, SQLite, logs, and diagnostics. Default sessions do not write audio or screenshots.

## Testing

Testing includes unit, provider contract, IPC integration, Electron end-to-end, packaged security, Windows device/capture matrix, latency, soak, privacy, deletion, and signed-update validation. Synthetic audio and screenshot fixtures are used for repeatable tests.

## Scope boundary

The MVP excludes accounts, billing, vendor telemetry, cloud databases, remote administration, hidden background recording, automatic job applications, second-device synchronization, macOS/Linux, and claims of guaranteed monitoring bypass.

## Self-review

- No placeholders or unresolved decisions remain.
- The BRD, architecture, security, and test documents use consistent MVP boundaries.
- Every privileged capability has a defined owner and trust boundary.
- Provider and capture fallbacks are explicit rather than silent.
- The design is appropriately decomposed for a phased implementation plan.

