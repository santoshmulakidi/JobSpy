# Business Requirements Document

## Local Windows AI Copilot

**Status:** Approved design baseline  
**Platform:** Windows first  
**Delivery model:** Separate desktop product  
**Architecture:** Electron + React + TypeScript  
**Data posture:** Local-first, bring your own API key

## 1. Purpose

Build a Windows desktop copilot that captures user-authorized microphone and system audio, produces live transcripts, optionally analyzes screenshots, and streams answers from a user-selected AI provider into a configurable desktop overlay.

The product must provide CueFlow-like functional convenience while improving security, privacy, transparency, and maintainability. It must not depend on a proprietary account service, subscription backend, telemetry pipeline, or vendor-hosted database.

## 2. Business objectives

1. Deliver a usable Windows MVP that can be installed and configured in under ten minutes.
2. Provide sub-second partial transcription under normal provider conditions.
3. Support multiple LLM providers without tying product releases to one vendor.
4. Keep user content local except for data deliberately sent to configured providers.
5. Establish a defensible security baseline suitable for a signed commercial desktop release.
6. Make capture state, retention, provider destination, and deletion controls understandable to a nontechnical user.

## 3. Target users

- Professionals seeking real-time notes and response assistance during authorized meetings.
- Candidates practicing or participating in sessions where assistance is permitted.
- Developers who need rapid explanation of code visible on their own screen.
- Accessibility users who benefit from live transcription and concise response drafting.
- Privacy-conscious users who prefer BYOK and local storage.

## 4. Product principles

- **User agency:** every capture source and outbound provider is user controlled.
- **Local first:** no product account or vendor cloud is required.
- **Memory first:** raw audio is not written to disk by default.
- **Explicit destination:** users can see where audio, text, and images are sent.
- **No silent fallback:** provider changes require configuration or user action.
- **Least privilege:** the renderer cannot directly access Node.js, files, secrets, or the shell.
- **Accurate claims:** capture exclusion is best effort, never marketed as guaranteed invisibility.

## 5. Scope

### 5.1 MVP capabilities

- Windows 10/11 x64 desktop installer.
- Frameless transparent overlay.
- System audio and optional microphone capture.
- Streaming speech-to-text with partial and committed segments.
- Manual and question-boundary answer submission.
- Optional single and bounded multi-screenshot context.
- Streaming Markdown and syntax-highlighted code answers.
- Gemini, OpenAI, Anthropic, and OpenRouter LLM adapters.
- Deepgram and ElevenLabs real-time transcription adapters.
- Provider/model selection and connection testing.
- BYOK secret storage protected by Windows DPAPI through Electron `safeStorage`.
- Prompt profiles: general meeting, technical interview, coding, behavioral, and custom.
- Local session history, search, export, per-session delete, and complete purge.
- Memory-only audio default and explicit recording opt-in.
- Global shortcuts, instant hide, opacity, font size, theme, window movement, resize, and click-through mode.
- Best-effort Windows capture exclusion.
- Redacted local diagnostics and provider latency metrics.

### 5.2 Out of scope for MVP

- macOS and Linux clients.
- User accounts, subscriptions, billing, entitlement servers, or remote analytics.
- Hosted API-key management.
- Automatic job application completion.
- Remote administration.
- Hidden background recording.
- Guaranteed bypass of proctoring, monitoring, endpoint security, or screen-capture systems.
- Second-device synchronization.
- Organization administration, team workspaces, RBAC, or centralized retention.

## 6. Functional requirements

### FR-1 Installation and onboarding

- The installer shall be Authenticode signed.
- The application shall explain microphone, system-audio, and screen-capture permissions before requesting them.
- Onboarding shall require at least one transcription provider and one answer provider.
- Provider credentials shall be validated with a minimal test request and stored only after success.

### FR-2 Audio sources

- Users shall independently enable system audio and microphone audio.
- The UI shall display current capture state and input devices.
- The audio engine shall resample to the active transcription provider's required format.
- Source loss shall trigger bounded reconnection without freezing the UI.
- Audio buffers shall be zeroed/released when a session ends.

### FR-3 Transcription

- The application shall display interim transcript text and committed segments separately.
- Users shall configure language, endpointing, VAD sensitivity, and microphone device.
- Committed segments shall retain timestamps and source attribution when available.
- Users shall edit transcript text before an AI request.

### FR-4 AI requests

- Users shall select provider and model.
- The application shall show the destination provider before the first request of a session.
- Requests shall support transcript-only, typed-only, screenshot-only, and combined context.
- Users shall cancel active requests and retry failures.
- A newer explicit request shall be able to supersede an older streaming request.
- Provider fallback shall be opt-in and visible.

### FR-5 Screenshots

- Screenshot capture shall require a user action or an explicitly enabled session setting.
- The user shall preview and remove images before transmission.
- The service shall downscale and compress images according to provider limits.
- The overlay shall be excluded where Windows supports it; otherwise the screenshot shall be redacted or the overlay temporarily hidden.
- Multi-capture shall have a configurable hard limit, initially five images per request.

### FR-6 Overlay

- The overlay shall support move, resize, opacity, theme, font-size, click-through, always-on-top, and instant hide.
- Shortcut conflicts shall be detected during configuration.
- The overlay shall not steal focus when streaming new text unless the user has enabled autofocus.
- Capture exclusion shall be labeled as best effort.

### FR-7 Prompt profiles

- Built-in profiles shall be immutable defaults that users can clone.
- Custom profiles shall contain system instructions, desired answer length, output language, tone, and domain context.
- Resume or job-context fields shall be stored locally and attached only when the active profile requests them.
- The application shall display a request-context summary without revealing API keys.

### FR-8 History and export

- Sessions shall store timestamps, transcripts, answers, model/provider identifiers, and optional user-approved recordings.
- Users shall delete one session, a date range, or all content.
- Export shall support Markdown and JSON in the MVP.
- Raw audio shall not be included unless separately selected.

### FR-9 Diagnostics

- Logs shall redact authorization headers, API keys, transcript bodies, screenshot data, and answer bodies by default.
- A support bundle shall contain version, operating system, provider IDs, timing, error codes, and configuration shape.
- Verbose content logging shall require a time-limited developer toggle and a warning.

## 7. Nonfunctional requirements

| Category | Requirement |
|---|---|
| Partial transcript latency | P95 under 400 ms, excluding provider/network failure |
| Overlay startup | Under 2 seconds on target hardware |
| First answer token | P95 under 2 seconds for a responsive low-latency model |
| Memory | Target below 350 MB during an ordinary session |
| Availability | Session remains controllable when one provider fails |
| Secrets | Never persisted in plaintext or returned to renderer state |
| Network | Outbound connections restricted to user-enabled provider hosts |
| Updates | Signed manifest and package verification before installation |
| Accessibility | Full keyboard operation, visible focus, high contrast, scalable text |
| Maintainability | Provider adapters pass a shared contract suite |
| Privacy | No telemetry; memory-only audio default; deterministic deletion |

## 8. Success metrics

- 90% of test users complete onboarding without support.
- 95% of 30-minute sessions complete without process restart.
- Zero API keys detected in automated log and database scans.
- At least 95% of explicit session deletions remove all indexed artifacts on first attempt.
- Median question-to-first-token time below 2.5 seconds on the recommended configuration.
- Crash-free session rate above 99% in controlled beta.

## 9. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Recording without consent | Legal/reputational | Permission disclosure, persistent capture indicator, policy acknowledgement |
| Provider sends data to third parties | Privacy | Destination banner, BYOK, provider policy links, screenshot preview |
| Renderer compromise | High security | Sandbox, context isolation, CSP, typed IPC, no remote code |
| Secret leakage | Account compromise | `safeStorage`, main-process-only access, redaction tests |
| Overlay appears in capture | User trust | Best-effort label, compatibility tests, preview mode |
| Provider/model removal | Session failure | Local catalog validation, visible fallback configuration |
| Audio drift or duplication | Poor answers | Source timestamps, jitter buffers, deduplication, replay tests |
| Electron vulnerability | Local compromise | Supported major, monthly dependency review, emergency update process |

## 10. Release acceptance

The MVP is acceptable only when:

1. All critical user journeys pass automated and manual testing.
2. Installer and update artifacts are signed.
3. Electron security checklist items have evidence.
4. No secrets or raw audio are written during a default session.
5. A provider-host allowlist test proves that unexpected outbound connections fail closed.
6. Deletion tests verify removal of session database rows and referenced files.
7. Capture behavior is documented without unsupported "undetectable" claims.

