# Local Windows AI Copilot - CueFlow Research Dossier

**Research date:** 2026-08-24  
**Inspected product:** CueFlow for Windows 2.0.4  
**Purpose:** Document observable behavior and implementation patterns needed to design an independent, local-first Windows AI copilot. This is a clean-room product analysis, not a request to copy CueFlow branding, credentials, proprietary services, or protected visual assets.

## 1. Executive findings

CueFlow 2.0.4 is an Electron desktop overlay paired with a web workspace. The desktop process owns audio capture, screenshots, prompt assembly, model calls, session history, and overlay behavior. The website supplies account, plan, usage, settings, and a second-device view called Duo.

The installed client currently uses:

| Function | Active implementation |
|---|---|
| Answer model | Gemini 3.1 Flash Lite |
| Answer fallback | Gemini 3.5 Flash Lite |
| Speech-to-text | Deepgram Nova-3 streaming |
| Alternative speech-to-text | ElevenLabs Scribe v2 Realtime |
| Meeting notes | Gemini 2.5 Flash, separately hard-coded |
| Gemini route | Gemini API / AI Studio mode, global region |

The key architectural conclusion is that CueFlow is not an on-device inference product. Capture and orchestration run locally, but transcription and answer generation use external cloud APIs. CueFlow's phrase "generates the answer on your machine" is best understood as "the desktop initiates and displays the request," not local model execution.

## 2. Evidence and confidence

| Finding | Evidence | Confidence |
|---|---|---|
| Version 2.0.4 | Installed package metadata and executable path | High |
| Electron 30.0.0 | Installed `package.json` | High |
| Active Gemini 3.1 Flash Lite | Local application settings record | High |
| Deepgram Nova-3 | Active setting plus shipped Deepgram client default | High |
| Model list changes without desktop releases | Runtime catalog code and cached backend catalog | High |
| Cloud inference | Provider SDKs, endpoints, and request clients in package | High |
| Local plaintext audio recording | `sessionLocalRecording.js` and local session directory | High |
| Seven-day audio cleanup | Startup cleanup implementation | High |
| Overlay exclusion | Electron `setContentProtection` usage | High |
| Guaranteed undetectability | Marketing claim only; technically unprovable | Low |

No credentials, tokens, private prompts, recordings, or personal session content were copied into this report.

## 3. Installed client composition

The Windows package uses Electron Forge and Squirrel. Significant dependencies include Electron, React-style web components, the OpenAI JavaScript SDK, Google's GenAI SDK, WebSockets, syntax highlighting, Markdown rendering, Mermaid, and image-processing utilities.

The application is organized into the following observable modules:

- Electron main process and window controller.
- React/web-component renderer.
- Audio capture and microphone processing.
- Deepgram and ElevenLabs streaming transcription clients.
- OpenAI, Gemini, DeepSeek, Grok, and Vertex AI clients.
- Runtime model catalog and fallback routing.
- Prompt composition and answer formatting.
- Screenshot capture and image preparation.
- Local session history and PCM recording.
- Authentication, subscription, usage, and update services.
- Transparent overlay, shortcuts, click-through, and content protection.

## 4. Runtime model registry

CueFlow does not bundle a fixed answer-model list. It downloads a catalog from its backend and applies it atomically. The cached catalog inspected on this machine contains 19 models across four providers:

- **DeepSeek:** V4 Flash, V4 Pro.
- **Google Gemini:** 3.1 Flash Lite, 3.1 Pro Preview, 3.5 Flash, 3.5 Flash Lite, 3.6 Flash, 3.7 Flash.
- **xAI:** Grok 4.3, 4.5, 4.6.
- **OpenAI:** GPT-4.1 Mini, GPT-5.4, GPT-5.4 Mini, GPT-5.4 Nano, GPT-5.5, GPT-5.6 Luna, GPT-5.6 Terra, GPT-5.6 Sol.

Each record can define provider adapter, base URL, context window, output limit, capabilities, request defaults, price metadata, deprecation status, and fallback model IDs. A malformed catalog is rejected so it cannot destroy the last known good snapshot.

Our product should retain the adapter abstraction but use a local signed catalog. Optional provider metadata refreshes may be added later, but model identity must never be silently changed by an untrusted remote source.

## 5. Audio and transcription pipeline

CueFlow captures microphone and system loopback audio. Its Deepgram client sends linear PCM over a WebSocket to `/v1/listen` with Nova-3, interim results, punctuation, filler words, VAD events, endpointing, and utterance-end detection. Interim text replaces the active draft; speech-final and utterance-end events commit a segment.

The shipped defaults are approximately:

- Model: `nova-3`.
- Endpointing: 300 ms.
- Utterance end: 1,200 ms.
- Keepalive: 5 seconds.
- Session recording format: PCM16 little-endian, 24 kHz, mono.

ElevenLabs Scribe v2 Realtime is available as an alternative. The code labels Deepgram as the production default and ElevenLabs as testing.

Our design should make transcription provider choice explicit. Audio must remain in memory by default, use bounded buffers, and be erased immediately when the stream closes. Persistent recording must require an explicit session-level opt-in.

## 6. Prompt and answer pipeline

After a transcript segment is committed, CueFlow assembles a model request from:

- The current question or typed instruction.
- Recent conversation turns.
- The selected interview/profile prompt.
- Candidate context such as skills, resume, job description, and introduction.
- Optional screenshots.
- A no-screen instruction when no screenshot is attached.

It then routes to the selected provider adapter and streams output into the overlay. Warmup requests and provider-specific fallback chains reduce perceived latency. Requests can be cancelled, retried, or replaced when a newer question supersedes the active one.

Our version should use a provider-neutral request envelope, deterministic token budgeting, explicit screenshot consent per submission, and no silent provider fallback.

## 7. Overlay and capture behavior

CueFlow creates a frameless transparent BrowserWindow that can be always on top, hidden from the taskbar, made click-through, resized, moved with shortcuts, and protected from ordinary screen capture. Electron's `setContentProtection(true)` is used when the user enables the feature or while CueFlow captures screenshots for AI.

On Windows, CueFlow briefly hides its window so the display stream captures the content behind it. On macOS it uses a helper built on ScreenCaptureKit and falls back to Electron desktop capture.

These controls reduce accidental inclusion in conventional screenshots and screen sharing. They do not make a process impossible to detect, do not remove it from system process listings, and cannot guarantee compatibility with every capture or monitoring product.

## 8. Storage and privacy behavior

Observed local storage includes:

- Encrypted access and refresh tokens using Electron `safeStorage`.
- Cached AI model catalog.
- Local application settings and history in Chromium storage.
- PCM microphone and speaker recordings under the Electron user-data directory.
- Update and diagnostic logs.

Local session recording is enabled by default in CueFlow. A startup cleanup removes recording directories older than seven days. Files are raw PCM and are not individually encrypted.

CueFlow's public privacy policy says it may collect recordings, transcripts, screenshots, account information, usage data, device information, and logs; may share information with hosting, analytics, and transcription providers; does not sell customer data; and does not train on customer data without consent. The policy says users may contact support to enable end-to-end encryption, which does not establish that end-to-end encryption is the default.

Our version will invert this posture: no account, telemetry, cloud database, or default recording; BYOK credentials encrypted with OS facilities; and an outbound-host allowlist visible to the user.

## 9. Security assessment of CueFlow 2.0.4

### Positive controls

- Uses OS-backed encryption for stored session tokens.
- Keeps provider keys out of ordinary preference normalization.
- Enables web security and rejects most renderer permission requests.
- Uses HTTPS/WSS provider endpoints.
- Implements bounded fallback and cancellation logic.
- Cleans old local audio rather than retaining it indefinitely.

### Material concerns

1. **Unsigned Windows executable.** The installed primary executable does not carry a valid Authenticode signature.
2. **Unsupported Electron runtime.** Electron 30 is end-of-life and embeds an old Chromium/Node stack.
3. **Legacy renderer privileges.** Unless an environment flag is set, the shipped default enables Node integration and disables context isolation. This turns a renderer compromise into a much more serious local-code-execution risk.
4. **Plaintext local audio.** Raw microphone and speaker audio is written by default.
5. **Marketing overstatement.** "Undetectable" and "zero traces" cannot be guaranteed by the implemented operating-system APIs.
6. **Limited public source history.** The release repository is public but exposes little reviewable history, while the installed package contains source inside its ASAR.

## 10. Clean-room lessons for our product

- Use a currently supported Electron release and upgrade on every supported-major cadence.
- Enable sandboxing and context isolation globally; never enable Node integration in the renderer.
- Expose only schema-validated, task-specific IPC methods.
- Keep audio memory-only unless the user opts in to recording.
- Store BYOK secrets with `safeStorage`/DPAPI and never return them to renderer state.
- Require a preview/confirmation before sending screenshots.
- Display exact destinations and active providers during a session.
- Sign installers and update manifests; publish SHA-256 hashes and an SBOM.
- Describe capture exclusion as best effort rather than "undetectable."
- Make session deletion deterministic and verifiable.

## 11. Primary references

- CueFlow product: https://www.cueflow.co.in/
- CueFlow privacy policy: https://www.cueflow.co.in/privacy
- CueFlow terms: https://www.cueflow.co.in/terms
- CueFlow release repository: https://github.com/Nandi5555/CueFlow_release
- Electron security guidance: https://www.electronjs.org/docs/latest/tutorial/security
- Electron BrowserWindow API: https://www.electronjs.org/docs/latest/api/browser-window/
- Electron desktop capture API: https://www.electronjs.org/docs/latest/api/desktop-capturer/
- Electron release schedule: https://releases.electronjs.org/schedule
- Gemini 3.1 Flash Lite: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
- Deepgram Nova-3: https://developers.deepgram.com/docs/models-languages-overview/
- ElevenLabs Scribe Realtime: https://elevenlabs.io/docs/overview/capabilities/speech-to-text/

