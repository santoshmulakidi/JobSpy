# Resume Lab Profile, Orchestration, and Cover Letter Design

Date: 2026-08-11
Status: Approved

## Objective

Turn the existing VM-hosted Resume Lab into the central resume-generation system used from Windows and Mac. Persist resume profiles on the VM, provide two explicit resume-generation modes, target an internal ATS score of at least 85 without fabricating experience, and generate cover letters only from a successfully generated resume through Google Gemini.

## Scope

This change covers Resume Lab profiles, saved source resumes, resume-generation routing, ATS-guided repair, model event reporting, result caching, cover-letter eligibility, and the Resume Lab UI. It does not change job collection search terms, location filtering elsewhere in the application, application tracking, or the email scheduler.

## Central Profile Storage

Create a dedicated database-backed Resume Lab profile collection. Each profile has:

- Stable profile ID.
- Unique display name.
- Optional saved source-resume text.
- Optional original resume filename.
- Created and updated timestamps.

Seed `.NET Developer`, `Java Developer`, and `AI Engineer` profiles. Resume Lab no longer displays or edits Target Search or Location Preferences.

An attached DOCX or TXT resume is parsed and immediately saved to the selected VM profile. Edited resume text is saved with **Save profile**. Profiles and resumes therefore load consistently from Windows, Mac, and other browsers.

On the first Resume Lab load after deployment, the frontend automatically uploads a browser-local profile resume only when the corresponding VM profile has no saved resume. A browser copy never overwrites a non-empty VM copy. After a successful migration, the browser copy remains only as a temporary compatibility fallback and is no longer the authoritative source.

**Remove saved resume** requires confirmation and clears only the saved text and filename. It keeps the profile. Generation is disabled for that profile until another source resume is attached, pasted, and saved.

## Resume Lab Layout

The profile card contains:

- Profile selector.
- Attach resume control.
- New profile control.
- Remove saved resume control when a resume exists.
- A compact, collapsible Resume editor.
- Save profile and Copy resume text buttons directly below the editor.

The existing Target Search and Location Preferences controls are removed from Resume Lab. Other pages that use job-search configuration remain unchanged.

The generation area contains a two-option selector with descriptions, a Generate Resume action, current progress, model and fallback events, ATS attempts, final score, warnings, and estimated token usage.

## Generation Modes

### NVIDIA-First Hybrid - Default

1. NVIDIA DeepSeek V4 Pro writes the resume from the original saved resume, job description, target title, and company.
2. OpenRouter Qwen 3.7 Plus reviews the draft.
3. If Qwen fails with a retryable provider failure, OpenRouter Kimi K2.5 reviews the same writer draft.
4. If NVIDIA fails, any partial NVIDIA output is discarded. The workflow restarts from the original resume and job description using OpenRouter DeepSeek V4 Pro as writer, OpenRouter Qwen 3.7 Plus as reviewer, and OpenRouter Kimi K2.5 as reviewer fallback.

### Final Resume - Important Application

1. Skip NVIDIA.
2. OpenRouter DeepSeek V4 Pro writes immediately.
3. OpenRouter Qwen 3.7 Plus reviews.
4. OpenRouter Kimi K2.5 reviews the same draft if Qwen has a retryable failure.

Provider and model identifiers remain configuration values. Deployment validation must confirm that each configured identifier is present in the provider's current model catalog before enabling the associated mode.

## Provider Failures and Events

The backend returns structured events with a stable code, severity, stage, provider, model, attempt, timestamp, and safe message. Supported event codes include:

- `WRITER_STARTED`
- `WRITER_SUCCEEDED`
- `NVIDIA_FAILURE`
- `PAID_FALLBACK_ACTIVATED`
- `REVIEWER_STARTED`
- `REVIEWER_FALLBACK`
- `ATS_REPAIR_STARTED`
- `ATS_TARGET_REACHED`
- `ATS_TARGET_NOT_REACHED`
- `CACHE_HIT`
- `FINAL_FAILURE`

Events and logs never contain API keys, authorization headers, full prompts, source resumes, or provider URLs containing credentials.

Retryable failures include timeouts, connection failures, HTTP 408, 429, and temporary 5xx responses. Authentication, permission, credit, invalid-model, and invalid-request failures are reported distinctly and are not retried across keys unless the provider contract explicitly identifies them as temporary.

A writer failure never produces a successful resume. If both reviewers fail, the writer draft is retained only as a diagnostic draft; it is not marked reviewed, does not enable Cover Letter, and is not presented as a final successful result.

## Truthful Keyword Planning

Before calling the writer, the backend extracts exact phrases and requirements from the job description and compares them against the source resume and a normalized fact inventory.

It creates:

- **Required supported keywords:** Exact JD phrases supported by the source resume. The writer must place these naturally in the summary, skills, or a relevant recent role as directed.
- **Unsupported JD keywords:** Phrases that cannot be verified from the source resume. The writer must not add them and must report them as gaps.

The reviewer receives the source resume as the sole source of truth and checks employers, dates, education, certifications, technologies, responsibilities, and numeric claims. Deterministic validation rejects unsupported numeric claims and missing source roles.

The English rules from `blader/humanizer` are adapted into the writing and review instructions: remove AI filler and promotional language, vary sentence and bullet structure, use concrete supported details, and perform a final AI-pattern audit without adding facts. `Humanizer-zh` is not installed because the current resumes are English and it is primarily a Chinese adaptation of the same guidance.

Ponytail is used as a development principle to avoid unnecessary implementation complexity. It is not installed in the production Resume Lab. Caveman is not placed in the resume pipeline because lossy or aggressive context compression could remove source evidence required for factual rewriting.

## Recent Role Title Matching

Determine the target title from the explicit job title field when available; otherwise extract it from the job description. Replace the displayed job-title line for the two most recent roles with the target title. Preserve employer names, locations, dates, projects, responsibilities, and all other facts. Record the original titles in generation metadata so the transformation is traceable.

## ATS Target and Targeted Repair

Resume Lab's ATS score is an internal matching heuristic, not a guarantee of an employer ATS result.

1. Run the selected complete writer and reviewer workflow once.
2. Score the reviewed result locally on the VM; local scoring uses no model tokens.
3. If the score is at least 85, stop.
4. If the score is below 85, create a compact repair request containing supported missing phrases, the verified fact inventory, and only the summary, skills, and two recent roles.
5. Run no more than two targeted repair passes, scoring after each and stopping immediately at 85.
6. Preserve and return the highest-scoring truthful reviewed version.
7. If no version reaches 85, return the best truthful version with `ATS_TARGET_NOT_REACHED` and list the unsupported or unresolved gaps.

Targeted repairs may not alter older roles, employers, dates, education, contact information, or unsupported facts. They may not add a JD requirement that is absent from the source resume merely to increase the score.

## Token and Result Optimization

The backend stores a compact verified fact inventory for each saved source resume. The inventory is invalidated whenever that source resume changes.

A completed generation cache is keyed by the normalized source-resume hash, job-description hash, target title, company, generation mode, orchestration version, and model configuration version. Identical inputs can return the prior successful result without another provider charge. A reviewer fallback reuses the existing writer draft. ATS scoring and keyword extraction run locally.

Expected usage is approximately 18,000 to 30,000 tokens for a normal two-pass first generation and approximately 25,000 to 45,000 tokens in the targeted-repair worst case. Actual usage depends on resume and JD length and provider tokenization. Cache hits require no new generation tokens.

## Cover Letter Workflow

The Cover Letter action begins disabled. It becomes enabled only when the current inputs have a successfully reviewed generated resume.

Cover-letter generation uses:

- The newly generated resume, never the uploaded source resume.
- Current job description.
- Current target title.
- Current company.
- Google Gemini only.

Gemini keys rotate only for rate limits, timeouts, connection failures, and temporary service failures. If every configured Gemini key fails, generation stops with a visible error. OpenRouter and NVIDIA are never called for cover-letter fallback.

The cover letter is invalidated and the action disabled when the source resume, selected profile, job description, target title, company, generation mode, or generated resume changes. Generating another resume also invalidates the previous cover letter.

The server verifies the input and generated-resume hashes when a cover-letter request is received; browser state alone is not trusted.

## API and Data Boundaries

Add focused profile CRUD endpoints, including a dedicated saved-resume removal operation. Resume-generation requests name the profile, mode, source version, job inputs, and an idempotency key. Responses include status, final content when successful, ATS scores, attempt summaries, token estimates or provider usage when available, and structured events.

Generation records use explicit states such as `QUEUED`, `WRITING`, `REVIEWING`, `REPAIRING`, `REVIEWED`, `WRITER_ONLY`, and `FAILED`. Only `REVIEWED` enables cover-letter generation.

Concurrent duplicate requests with the same idempotency key return the existing run rather than creating multiple paid calls.

## Error Handling

- Missing profile resume or insufficient JD returns a validation error before any provider call.
- An unavailable configured model produces a configuration error and a visible event.
- NVIDIA failure in Hybrid mode emits the failure and paid-fallback events before restarting from original inputs.
- A failure during paid fallback stops with a final error after the documented reviewer fallback is exhausted.
- ATS repair failure keeps the best previously reviewed version and reports the failure.
- Database and cache failures do not expose secrets or resume text in logs.

## Testing and Acceptance Criteria

Automated backend and frontend tests cover:

- Creating and loading the seeded AI Engineer profile.
- Saving an attached or edited resume centrally.
- Migrating a browser-local resume only into an empty VM profile.
- Removing only the saved resume while preserving the profile.
- Hiding Target Search and Location Preferences in Resume Lab.
- Default Hybrid routing and paid restart from original inputs.
- Important mode skipping NVIDIA.
- Qwen-to-Kimi reviewer fallback without rerunning the writer.
- Stable, redacted provider events.
- Supported and unsupported keyword classification.
- Replacement of the two most recent displayed role titles.
- One full generation and at most two targeted repairs.
- Early stop at ATS 85 and retention of the best truthful version.
- Unsupported numeric-claim and missing-role rejection.
- Cache hits and duplicate-request idempotency.
- Cover Letter disabled before reviewed generation.
- Cover Letter using only the newly generated resume.
- Cover-letter invalidation for every defined input change.
- Gemini key rotation on temporary failures and no paid-provider cover-letter fallback.

Before deployment, run the Python test suite, frontend type checking and production build, provider configuration validation without exposing secrets, and a browser smoke test of both generation modes. Deployment must preserve the existing dirty worktree changes and existing database data. Services are rebuilt or restarted only during the separately approved deployment step.
