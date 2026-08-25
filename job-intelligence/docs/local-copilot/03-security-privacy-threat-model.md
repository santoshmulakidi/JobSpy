# Local Windows AI Copilot - Security, Privacy, and Threat Model

## 1. Security objectives

1. A compromised renderer cannot read provider keys, arbitrary local files, or execute operating-system commands.
2. Content is transmitted only to providers enabled by the user.
3. Default sessions do not persist raw audio or screenshots.
4. Logs and support bundles do not reveal session content or secrets.
5. Installer and updates are authentic and tamper evident.
6. Capture status, retention, and deletion are understandable and verifiable.

## 2. Trust boundaries

```text
Untrusted/low trust                     Privileged
────────────────────────────────────────────────────────────
React renderer ──typed IPC──> preload ──validated IPC──> main
Provider responses ─────────> adapters ──normalized events──> UI
Audio devices ──────────────> utility process ───────────────> STT
Captured screen ────────────> screenshot service ────────────> LLM
Local database <──────────── main process only
DPAPI secrets <───────────── main process only
```

Provider output, transcript text, screenshots, imported prompts, and Markdown are treated as untrusted content.

## 3. Threats and controls

| Threat | Primary controls | Verification |
|---|---|---|
| Renderer XSS becomes RCE | No Node integration, context isolation, sandbox, CSP | Security integration test and packaged-config audit |
| Malicious IPC payload | Sender/origin validation, Zod schemas, allowlisted methods | Fuzz IPC inputs |
| API-key disclosure | `safeStorage`, main-process-only handles, redaction | Scan logs, DB, renderer snapshots, crash artifacts |
| Arbitrary outbound exfiltration | Main-process-only networking, host allowlist, redirect checks | Network integration test with deny server |
| Prompt injection from screen/transcript | Treat input as data, fixed system boundary, no tool execution | Adversarial fixture suite |
| Generated Markdown attack | Sanitize HTML/URLs, no remote image loading | XSS corpus |
| Screenshot captures overlay | `setContentProtection`, preview, hide fallback | Capture matrix across supported apps |
| Hidden unintended recording | Explicit state machine, local indicator, memory-only default | Session lifecycle tests |
| Residual audio in memory/disk | Bounded buffers, release on stop, no default writer | File-system and heap-oriented tests |
| Malicious update | Signed manifests/artifacts, pinned update origin | Tampered-update test |
| Dependency compromise | Lockfile, SBOM, provenance, automated audit | CI policy gate |
| Database corruption | Transactions, migrations, backups before upgrade | Fault injection and migration rollback tests |
| Shortcut abuse/conflict | Allowlist, conflict detection, reset-safe mode | Shortcut matrix |

## 4. Electron hardening requirements

- Use a supported Electron release.
- Call `app.enableSandbox()` before application readiness.
- Set `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true` for every renderer.
- Load local packaged assets through a custom privileged protocol rather than unrestricted `file://` navigation.
- Apply a CSP similar to `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'`.
- Deny navigation and new windows except explicit sanitized external links opened through an allowlisted handler.
- Deny all session permissions by default; grant only task-specific media permissions after an authenticated local user gesture.
- Validate the sender frame and origin for every IPC handler.
- Expose functions, never raw `ipcRenderer` methods.
- Disable remote modules, webviews, spellcheck network services, experimental Blink features, and unnecessary command-line switches.
- Configure Electron fuses to disable run-as-node and enforce ASAR integrity where supported.

## 5. Secret management

- Store each provider key as a separate `safeStorage` ciphertext.
- Persist only a random secret reference in SQLite.
- Do not decrypt until constructing an outbound request.
- Never send decrypted values to renderer, worker logs, analytics, exceptions, or support bundles.
- Clear secret-bearing strings/buffers as far as practical after use.
- Provide test, replace, and delete actions.
- Mark clipboard copy of secrets as an exceptional explicit action; default UI reveals only last four characters.

## 6. Privacy requirements

### Default session

- Audio frames exist only in bounded memory.
- Transcript and answers may be written to local history unless ephemeral mode is selected.
- Screenshots exist only until the associated request completes or is cancelled.
- No telemetry, account identity, or vendor cloud is used.

### Optional recording

- Recording requires an explicit session toggle and destination folder.
- The UI states sources, format, location, and retention before enabling.
- A persistent in-app indicator remains visible while recording.
- End-of-session UI offers keep, export, or delete.
- Recording files are never uploaded automatically.

### Deletion

- Deleting a session removes database records and associated explicitly saved attachments/recordings selected for deletion.
- A deletion receipt records only counts and completion status, not content.
- Complete purge deletes database content, diagnostics, caches, and encrypted provider credentials after a final local confirmation.

## 7. Compliance and responsible-use requirements

- Onboarding shall state that users are responsible for meeting, workplace, examination, interview, and recording-consent rules.
- The application shall not promise invisibility or guaranteed bypass of monitoring systems.
- Capture exclusion shall be described as an operating-system compatibility feature.
- The application shall not conceal recording state from its operator.
- Provider privacy-policy links and data categories shall be presented during configuration.
- Organization deployments should later support policy-enforced disabling of screenshots or recording.

## 8. Security release gates

- No critical/high unresolved dependency vulnerabilities without documented exception.
- Packaged renderer configuration audit passes.
- IPC fuzz tests produce no privilege escalation or main-process crash.
- Secret scan finds no credentials in artifacts, logs, fixtures, or source maps.
- Network allowlist tests reject unknown hosts and off-allowlist redirects.
- Installer and update signatures validate on clean Windows VMs.
- Capture and deletion tests pass on Windows 10 22H2 and current Windows 11 releases.
- Independent manual security review before public beta.

## 9. Incident response

- Provide a local safe mode that disables providers, capture, and plugins.
- Maintain a kill switch only for vulnerable update versions through a signed local update manifest; no remote control channel.
- Publish a security contact and coordinated disclosure policy.
- Revoke compromised signing credentials and rotate update keys through an offline recovery procedure.
- Notify users precisely which versions and data paths are affected.

