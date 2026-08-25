# Local Windows AI Copilot - Test and Validation Strategy

## 1. Test goals

- Prove capture and streaming behavior under realistic Windows conditions.
- Prevent secret/content leakage.
- Verify renderer isolation and IPC authorization.
- Validate provider adapters against a common contract.
- Measure end-to-end latency and recovery behavior.
- Confirm capture exclusion is described and tested as best effort.

## 2. Automated test layers

### Unit tests

- Audio resampling, timestamps, mixing, and VAD boundary logic.
- Transcript deduplication and commit rules.
- Context-window budgeting and history trimming.
- Provider capability normalization.
- Markdown sanitization and streaming code-fence handling.
- State-machine transition legality.
- Retention and deletion planners.
- Redaction of keys, content, headers, and provider error bodies.

### Contract tests

Every STT adapter must pass fixtures for connect, partial, committed, reconnect, quota error, malformed event, cancellation, and close.

Every LLM adapter must pass fixtures for model discovery, text streaming, image support, cancellation, rate limit, authentication failure, unknown completion, usage reporting, and timeout.

Live provider tests are opt-in and use dedicated low-privilege test keys.

### Integration tests

- Main/preload/renderer IPC schemas.
- SQLite migrations and interrupted upgrades.
- `safeStorage` create/read/replace/delete lifecycle.
- Host allowlist and redirect denial.
- Screenshot preview, removal, and buffer cleanup.
- Audio utility process crash/restart.
- Export and deterministic deletion.

### End-to-end tests

- First-run onboarding.
- Start, pause, resume, and stop a session.
- Transcript-only AI request.
- Screenshot-assisted AI request.
- Cancel and supersede a streaming answer.
- Provider authentication failure and recovery.
- Overlay shortcuts, click-through, movement, and instant hide.
- Ephemeral session leaves no content in SQLite or session files.
- Opt-in recording produces the documented files and deletion behavior.

## 3. Security tests

- Attempt `require`, filesystem access, shell execution, and unrestricted IPC from renderer.
- Inject script-bearing transcript, model output, Markdown, URL, and screenshot OCR text.
- Fuzz every IPC payload with missing, excessive, malformed, and prototype-pollution values.
- Force redirects from an allowed provider host to an unapproved host.
- Inspect packaged source maps and resources for keys.
- Scan logs, SQLite, crash dumps, and exports after synthetic secret-bearing sessions.
- Tamper with installer/update payload and verify rejection.
- Verify CSP and navigation restrictions in the packaged build, not only development.

## 4. Audio test matrix

| Dimension | Cases |
|---|---|
| Windows | Windows 10 22H2; supported Windows 11 releases |
| Devices | Built-in mic, USB headset, Bluetooth, dock audio, virtual cable |
| System sources | Teams, Zoom, Meet in browser, media playback, silence |
| Sample rates | 16, 24, 44.1, and 48 kHz inputs |
| Conditions | Device disconnect, default-device change, sleep/resume, network loss |
| Speech | Accents, pauses, overlapping voices, code terms, noisy room |

Golden PCM fixtures provide deterministic regression tests without transmitting real user audio.

## 5. Capture compatibility matrix

For each supported Windows version and meeting application:

1. Capture the whole display using the application's normal share/record method.
2. Verify whether the overlay is excluded.
3. Verify the underlying content remains available to the user's screenshot request.
4. Test transparent, click-through, always-on-top, minimized, and multi-monitor states.
5. Record the outcome as supported, partial, or unsupported.

No result may be generalized into an "undetectable" claim.

## 6. Performance tests

Measure:

- Application cold/warm launch.
- Audio frame processing delay.
- STT partial and commit latency.
- Question-boundary-to-request time.
- LLM time to first token and completion.
- Overlay rendering rate during streaming.
- Memory and handle growth over 15-, 60-, and 240-minute sessions.
- SQLite growth and history-search latency.

Performance reports separate local processing from provider/network latency.

## 7. Privacy validation

- Run a default synthetic session and assert no audio/screenshot files exist.
- Run ephemeral mode and assert no transcript/answer rows remain.
- Delete a normal session and validate referential/file cleanup.
- Export diagnostics and scan for synthetic PII, keys, transcript, and answer text.
- Capture outbound DNS/TLS destinations and compare with configured provider allowlist.

## 8. Release test sequence

1. Static checks, type checks, unit tests.
2. Provider contract fixtures.
3. Packaged-build security audit.
4. Windows VM integration matrix.
5. Signed-installer clean-install and upgrade tests.
6. Four-hour soak session with synthetic audio.
7. Manual accessibility and overlay compatibility pass.
8. Artifact signature, hash, SBOM, and secret verification.
9. Release-candidate approval.

