# Resume Lab Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VM-backed Resume Lab with central profiles, NVIDIA-first and OpenRouter-only resume modes, truthful ATS-guided repairs, cached results, and Gemini-only cover letters generated from reviewed resumes.

**Architecture:** Add dedicated `ResumeLabProfile` and `ResumeLabRun` records without changing the existing job-search `UserProfile`. Put keyword planning and model orchestration in focused AI modules, expose new Resume Lab API endpoints, then replace browser-only profile/model state in the Next.js page with those APIs. Preserve existing resume generation endpoints for other application flows.

**Tech Stack:** Python 3.12, FastAPI, Pydantic 2, SQLAlchemy 2, SQLite/Alembic, httpx, pytest, Next.js 15, React 19, TypeScript 5.9, Vitest.

## Global Constraints

- Preserve all existing uncommitted VM changes and existing database data.
- Seed `.NET Developer`, `Java Developer`, and `AI Engineer` Resume Lab profiles.
- Remove Target Search and Location Preferences only from Resume Lab; do not change collection or search behavior elsewhere.
- Replace the displayed title of the two most recent roles with the current JD target title while preserving employers, dates, locations, responsibilities, education, contact details, and other facts.
- Use one complete writer/reviewer workflow plus at most two targeted ATS repair passes; stop at an internal score of 85.
- Never add an unsupported JD keyword, numeric claim, employer, date, degree, certification, technology, or responsibility.
- NVIDIA failure in Hybrid mode must discard partial output and restart from the original source resume and JD on OpenRouter.
- A reviewer fallback reuses the same writer draft. Both reviewers failing must not produce a `REVIEWED` run.
- Cover letters use the newly generated reviewed resume and Gemini only; all Gemini keys failing must never call NVIDIA or OpenRouter.
- Never log secrets, full source resumes, full prompts, authorization headers, or URLs containing API keys.
- Do not install Ponytail, Caveman, Humanizer, or Humanizer-zh in the production application. Adapt the relevant English human-writing rules into prompts and validators.

---

## File Map

- `storage/models.py`: `ResumeLabProfile` and `ResumeLabRun` persistence models.
- `storage/repository.py`: profile seeding/CRUD, optimistic resume updates, run idempotency, and cache lookup.
- `alembic/versions/0003_resume_lab_profiles_and_runs.py`: additive production schema migration.
- `api/schemas.py`: profile, generation, event, run, and cover-letter request/response contracts.
- `ai/resume_keyword_plan.py`: supported keyword plan, target-title extraction, recent-title transformation, hashes, and fact inventory.
- `ai/resume_orchestrator.py`: two routing modes, structured events, truth validation, targeted repairs, and usage aggregation.
- `ai/resume_rebuilder.py`: expose the existing provider call and validation helpers for the orchestrator without changing legacy behavior.
- `storage/config.py`: explicit provider model settings and orchestration version.
- `api/main.py`: Resume Lab profile, generation, cached-run, and Gemini cover-letter endpoints.
- `tests/test_resume_lab_profiles.py`: database and profile API behavior.
- `tests/test_resume_keyword_plan.py`: keyword evidence, title replacement, hashes, and fact inventory.
- `tests/test_resume_orchestrator.py`: routing, reviewer fallback, repair limits, events, truth checks, and usage.
- `tests/test_resume_lab_api.py`: idempotency, cache, cover-letter eligibility, and Gemini rotation.
- `frontend/types/job.ts`: Resume Lab API types.
- `frontend/lib/api.ts`: Resume Lab profile, generation, removal, and cover-letter clients.
- `frontend/lib/resume-lab-state.ts`: pure cover-letter eligibility/invalidation and browser migration helpers.
- `frontend/lib/resume-lab-state.test.ts`: frontend state rules.
- `frontend/app/resume-lab/page.tsx`: central profiles, compact editor, mode cards, event timeline, and cover-letter gating.
- `frontend/app/resume-lab/page.source.test.ts`: source-level UI contract for required and removed controls.
- `frontend/package.json` and `frontend/package-lock.json`: Vitest test command and dependency.

---

### Task 1: Central Resume Lab profile persistence

**Files:**
- Create: `alembic/versions/0003_resume_lab_profiles_and_runs.py`
- Modify: `storage/models.py`
- Modify: `storage/repository.py`
- Create: `tests/test_resume_lab_profiles.py`

**Interfaces:**
- Produces: `ResumeLabProfile`, `ResumeLabRun`, `JobRepository.list_resume_lab_profiles()`, `get_resume_lab_profile(profile_id)`, `upsert_resume_lab_profile(name)`, `save_resume_lab_resume(...)`, `clear_resume_lab_resume(profile_id)`.
- Consumes: existing `Base`, `utc_now()`, SQLAlchemy session patterns.

- [ ] **Step 1: Write failing persistence tests**

```python
def test_resume_lab_profiles_are_seeded_and_resume_can_be_removed(session):
    repository = JobRepository(session)
    profiles = repository.list_resume_lab_profiles()
    assert [p.name for p in profiles] == [".NET Developer", "Java Developer", "AI Engineer"]

    ai = next(p for p in profiles if p.name == "AI Engineer")
    saved = repository.save_resume_lab_resume(
        ai.id,
        resume_text="A" * 80,
        resume_filename="ai-engineer.docx",
        expected_source_version=0,
        only_if_empty=False,
    )
    assert saved.source_version == 1
    assert saved.resume_sha256

    cleared = repository.clear_resume_lab_resume(ai.id, expected_source_version=1)
    assert cleared.name == "AI Engineer"
    assert cleared.resume_text is None
    assert cleared.resume_filename is None
    assert cleared.source_version == 2


def test_browser_migration_never_overwrites_existing_vm_resume(session):
    repository = JobRepository(session)
    profile = repository.list_resume_lab_profiles()[0]
    repository.save_resume_lab_resume(
        profile.id, resume_text="V" * 80, resume_filename="vm.txt",
        expected_source_version=0, only_if_empty=False,
    )
    with pytest.raises(ResumeProfileConflict):
        repository.save_resume_lab_resume(
            profile.id, resume_text="B" * 80, resume_filename="browser.txt",
            expected_source_version=1, only_if_empty=True,
        )
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pytest tests/test_resume_lab_profiles.py -q`

Expected: FAIL because the models and repository methods do not exist.

- [ ] **Step 3: Add the models and additive migration**

```python
class ResumeLabProfile(Base):
    __tablename__ = "resume_lab_profiles"
    __table_args__ = (UniqueConstraint("name", name="uq_resume_lab_profiles_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    resume_text: Mapped[str | None] = mapped_column(Text)
    resume_filename: Mapped[str | None] = mapped_column(String(255))
    resume_sha256: Mapped[str | None] = mapped_column(String(64), index=True)
    fact_inventory: Mapped[dict | None] = mapped_column(JSON)
    source_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class ResumeLabRun(Base):
    __tablename__ = "resume_lab_runs"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_resume_lab_runs_idempotency_key"),
        Index("ix_resume_lab_runs_cache", "cache_key", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    cache_key: Mapped[str] = mapped_column(String(64), nullable=False)
    profile_id: Mapped[int] = mapped_column(ForeignKey("resume_lab_profiles.id"), index=True)
    mode: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="QUEUED")
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    job_description_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    target_title: Mapped[str] = mapped_column(String(500), nullable=False)
    company_name: Mapped[str | None] = mapped_column(String(255))
    content_text: Mapped[str | None] = mapped_column(Text)
    ats_score: Mapped[int | None] = mapped_column(Integer)
    events: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    usage: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    original_titles: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
```

The migration creates the same columns, constraints, indexes, and foreign key, with `down_revision = "126436604a64"`. Its downgrade drops only these two new tables and their indexes.

- [ ] **Step 4: Implement profile repository methods with optimistic version checks**

```python
class ResumeProfileConflict(ValueError):
    pass


def list_resume_lab_profiles(self) -> list[ResumeLabProfile]:
    for name in (".NET Developer", "Java Developer", "AI Engineer"):
        if not self.session.scalar(select(ResumeLabProfile).where(ResumeLabProfile.name == name)):
            self.session.add(ResumeLabProfile(name=name))
    self.session.flush()
    return list(self.session.scalars(select(ResumeLabProfile).order_by(ResumeLabProfile.id)))


def save_resume_lab_resume(self, profile_id: int, *, resume_text: str,
                           resume_filename: str | None, expected_source_version: int,
                           only_if_empty: bool) -> ResumeLabProfile:
    profile = self.session.get(ResumeLabProfile, profile_id)
    if profile is None:
        raise KeyError(profile_id)
    if profile.source_version != expected_source_version or (only_if_empty and profile.resume_text):
        raise ResumeProfileConflict("The saved resume changed; reload the profile before saving.")
    normalized = resume_text.strip()
    profile.resume_text = normalized
    profile.resume_filename = resume_filename
    profile.resume_sha256 = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    profile.fact_inventory = None
    profile.source_version += 1
    profile.updated_at = utc_now()
    self.session.flush()
    return profile
```

Implement `clear_resume_lab_resume()` with the same version check, setting the resume fields and fact inventory to `None` and incrementing `source_version`.

- [ ] **Step 5: Run profile tests and regression tests**

Run: `pytest tests/test_resume_lab_profiles.py tests/test_repository.py -q`

Expected: PASS.

- [ ] **Step 6: Commit the persistence slice**

```bash
git add storage/models.py storage/repository.py alembic/versions/0003_resume_lab_profiles_and_runs.py tests/test_resume_lab_profiles.py
git commit -m "feat: persist Resume Lab profiles"
```

---

### Task 2: Resume Lab profile API

**Files:**
- Modify: `api/schemas.py`
- Modify: `api/main.py`
- Modify: `tests/test_resume_lab_profiles.py`

**Interfaces:**
- Consumes: Task 1 repository methods.
- Produces: `GET /resume-lab/profiles`, `POST /resume-lab/profiles`, `PUT /resume-lab/profiles/{id}/resume`, `DELETE /resume-lab/profiles/{id}/resume`.

- [ ] **Step 1: Write failing API tests**

```python
def test_resume_profile_api_saves_and_removes_only_resume(client):
    profiles = client.get("/resume-lab/profiles").json()
    profile = next(p for p in profiles if p["name"] == "AI Engineer")
    saved = client.put(
        f"/resume-lab/profiles/{profile['id']}/resume",
        json={"resume_text": "R" * 80, "resume_filename": "resume.txt",
              "expected_source_version": 0, "only_if_empty": False},
    )
    assert saved.status_code == 200
    assert saved.json()["source_version"] == 1

    removed = client.delete(
        f"/resume-lab/profiles/{profile['id']}/resume?expected_source_version=1"
    )
    assert removed.status_code == 200
    assert removed.json()["name"] == "AI Engineer"
    assert removed.json()["resume_text"] is None


def test_resume_profile_api_returns_409_for_stale_save(client):
    profile = client.get("/resume-lab/profiles").json()[0]
    response = client.put(
        f"/resume-lab/profiles/{profile['id']}/resume",
        json={"resume_text": "R" * 80, "expected_source_version": 99,
              "only_if_empty": False},
    )
    assert response.status_code == 409
```

- [ ] **Step 2: Run API tests and verify RED**

Run: `pytest tests/test_resume_lab_profiles.py -q`

Expected: FAIL with 404 for the new endpoints.

- [ ] **Step 3: Add schemas and endpoints**

```python
class ResumeLabProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)


class ResumeLabResumeUpdate(BaseModel):
    resume_text: str = Field(min_length=50)
    resume_filename: str | None = Field(default=None, max_length=255)
    expected_source_version: int = Field(ge=0)
    only_if_empty: bool = False


class ResumeLabProfileOut(BaseModel):
    id: int
    name: str
    resume_text: str | None
    resume_filename: str | None
    resume_sha256: str | None
    source_version: int
    updated_at: datetime
    model_config = {"from_attributes": True}
```

Add endpoints that translate `KeyError` to 404, `ResumeProfileConflict` to 409, commit only after a successful repository call, and never return `fact_inventory`.

- [ ] **Step 4: Run API tests and full repository tests**

Run: `pytest tests/test_resume_lab_profiles.py tests/test_repository.py -q`

Expected: PASS.

- [ ] **Step 5: Commit the profile API**

```bash
git add api/schemas.py api/main.py tests/test_resume_lab_profiles.py
git commit -m "feat: expose Resume Lab profile API"
```

---

### Task 3: Truthful keyword planning and recent-title transformation

**Files:**
- Create: `ai/resume_keyword_plan.py`
- Create: `tests/test_resume_keyword_plan.py`

**Interfaces:**
- Produces: `KeywordPlan`, `build_fact_inventory(source_resume)`, `build_keyword_plan(source_resume, job_description)`, `extract_target_title(explicit_title, job_description)`, `replace_two_recent_titles(resume_text, target_title)`, `normalized_hash(*parts)`.
- Consumes: no provider or database code.

- [ ] **Step 1: Write failing keyword and title tests**

```python
def test_keyword_plan_requires_only_source_supported_jd_terms():
    plan = build_keyword_plan(
        "Senior engineer using Python, PyTorch, Azure, and REST APIs.",
        "AI Engineer requires Python, PyTorch, Azure, LangChain, and Kubernetes.",
    )
    assert plan.supported == ["Python", "PyTorch", "Azure"]
    assert plan.unsupported == ["LangChain", "Kubernetes"]
    assert plan.placements["PyTorch"] in {"skills", "recent_roles"}


def test_replace_two_recent_titles_preserves_employers_dates_and_older_title():
    transformed, originals = replace_two_recent_titles(THREE_ROLE_RESUME, "AI Engineer")
    assert originals == ["Senior .NET Developer", "Software Engineer"]
    assert transformed.count("AI Engineer") == 2
    assert "Acme Corp" in transformed and "2024 - Present" in transformed
    assert "Junior Developer | OldCo" in transformed


def test_hash_is_stable_after_line_ending_and_outer_space_changes():
    assert normalized_hash(" a\r\nb ") == normalized_hash("a\nb")
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pytest tests/test_resume_keyword_plan.py -q`

Expected: FAIL because `ai.resume_keyword_plan` does not exist.

- [ ] **Step 3: Implement deterministic planning**

```python
@dataclass(frozen=True)
class KeywordPlan:
    supported: list[str]
    unsupported: list[str]
    placements: dict[str, str]


def normalized_hash(*parts: str) -> str:
    normalized = "\x1f".join(re.sub(r"\s+", " ", part).strip() for part in parts)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def build_keyword_plan(source_resume: str, job_description: str) -> KeywordPlan:
    jd_terms = extract_jd_terms(job_description)
    evidence = normalized_evidence_terms(source_resume)
    supported = [term for term in jd_terms if normalize_term(term) in evidence]
    unsupported = [term for term in jd_terms if normalize_term(term) not in evidence]
    placements = {
        term: "skills" if term_is_skill(term) else "recent_roles"
        for term in supported
    }
    return KeywordPlan(supported=supported, unsupported=unsupported, placements=placements)
```

Exclude the extracted target job title from keyword evidence classification because it is handled by the separately approved title transformation. Use a fixed alias table only for canonical spelling, such as `.net`/`dotnet`, `c sharp`/`C#`, and `restful api`/`REST API`. Do not infer experience from occupational similarity. Target-title replacement must operate on parsed Professional Experience role headers, replace exactly the first two, and return the originals for audit metadata.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pytest tests/test_resume_keyword_plan.py -q`

Expected: PASS.

- [ ] **Step 5: Commit the deterministic planner**

```bash
git add ai/resume_keyword_plan.py tests/test_resume_keyword_plan.py
git commit -m "feat: plan truthful resume keywords"
```

---

### Task 4: Provider orchestration and structured events

**Files:**
- Create: `ai/resume_orchestrator.py`
- Modify: `ai/resume_rebuilder.py`
- Modify: `storage/config.py`
- Create: `tests/test_resume_orchestrator.py`

**Interfaces:**
- Consumes: Task 3 keyword plan, title transformation, and existing `_chat_completion()`/`_validate_generated_resume()` behavior.
- Produces: `GenerationMode`, `GenerationEvent`, `OrchestrationResult`, `orchestrate_resume(request, settings, completion=chat_completion)`.

- [ ] **Step 1: Write failing routing tests**

```python
def test_hybrid_uses_nvidia_writer_then_openrouter_qwen_reviewer(fake_completion):
    result = orchestrate_resume(hybrid_request(), settings(), completion=fake_completion)
    assert fake_completion.models == [NVIDIA_DEEPSEEK, OPENROUTER_QWEN]
    assert result.status == "REVIEWED"
    assert [event.code for event in result.events[:3]] == [
        "WRITER_STARTED", "WRITER_SUCCEEDED", "REVIEWER_STARTED"
    ]


def test_nvidia_failure_restarts_paid_writer_from_original_inputs(fake_completion):
    fake_completion.fail_once(NVIDIA_DEEPSEEK, httpx.ConnectError("offline"))
    result = orchestrate_resume(hybrid_request(), settings(), completion=fake_completion)
    assert fake_completion.models[:3] == [NVIDIA_DEEPSEEK, OPENROUTER_DEEPSEEK, OPENROUTER_QWEN]
    assert fake_completion.messages_for(OPENROUTER_DEEPSEEK).source_resume == BASE_RESUME
    assert "partial nvidia" not in fake_completion.messages_for(OPENROUTER_DEEPSEEK).text
    assert "NVIDIA_FAILURE" in result.event_codes
    assert "PAID_FALLBACK_ACTIVATED" in result.event_codes


def test_qwen_failure_reuses_writer_draft_for_kimi(fake_completion):
    fake_completion.fail_once(OPENROUTER_QWEN, TemporaryProviderError("503"))
    result = orchestrate_resume(important_request(), settings(), completion=fake_completion)
    assert fake_completion.models == [OPENROUTER_DEEPSEEK, OPENROUTER_QWEN, OPENROUTER_KIMI]
    assert fake_completion.messages_for(OPENROUTER_KIMI).writer_draft == fake_completion.writer_draft
    assert "REVIEWER_FALLBACK" in result.event_codes


def test_both_reviewers_failing_never_returns_reviewed(fake_completion):
    fake_completion.fail(OPENROUTER_QWEN, OPENROUTER_KIMI)
    result = orchestrate_resume(important_request(), settings(), completion=fake_completion)
    assert result.status == "WRITER_ONLY"
    assert result.resume_text is None
    assert result.diagnostic_draft
```

- [ ] **Step 2: Run orchestration tests and verify RED**

Run: `pytest tests/test_resume_orchestrator.py -q`

Expected: FAIL because the orchestrator does not exist.

- [ ] **Step 3: Add explicit provider configuration**

```python
resume_orchestration_version: str = "2026-08-11-v1"
nvidia_resume_writer_model: str = "deepseek-ai/deepseek-v4-pro"
openrouter_resume_writer_model: str = "deepseek/deepseek-v4-pro"
openrouter_resume_reviewer_model: str = "qwen/qwen3.7-plus"
openrouter_resume_reviewer_fallback_model: str = "moonshotai/kimi-k2.5"
resume_ats_target: int = 85
resume_max_repairs: int = 2
```

Keep the existing OmniRoute settings for backward compatibility until a later separately scoped cleanup.

- [ ] **Step 4: Implement orchestration with dependency-injected completion**

```python
class GenerationMode(StrEnum):
    HYBRID = "HYBRID"
    IMPORTANT = "IMPORTANT"


@dataclass
class GenerationEvent:
    code: str
    severity: str
    stage: str
    provider: str | None
    model: str | None
    attempt: int
    timestamp: str
    message: str


def orchestrate_resume(request: OrchestrationRequest, settings: Settings,
                       completion: CompletionFn = chat_completion) -> OrchestrationResult:
    keyword_plan = build_keyword_plan(request.source_resume, request.job_description)
    writer = nvidia_writer(settings) if request.mode is GenerationMode.HYBRID else openrouter_writer(settings)
    try:
        draft = completion(writer, writer_messages(request, keyword_plan))
    except TemporaryProviderError:
        if request.mode is not GenerationMode.HYBRID:
            raise
        emit("NVIDIA_FAILURE", "warning", "writer", writer)
        emit("PAID_FALLBACK_ACTIVATED", "warning", "writer", openrouter_writer(settings))
        draft = completion(openrouter_writer(settings), writer_messages(request, keyword_plan))

    reviewed = review_with_fallback(
        draft=draft, request=request, primary=openrouter_qwen(settings),
        fallback=openrouter_kimi(settings), completion=completion,
    )
    return finalize_reviewed_resume(reviewed, request, keyword_plan, events)
```

Writer and reviewer prompts must include the supported keyword list and placements, unsupported list, source resume as sole truth, original title audit, no-fabrication rules, and the English Humanizer-derived checks. Map only timeout/connection/408/429/5xx to `TemporaryProviderError`; map 401/403/402/404/invalid request to explicit non-retryable errors. Redact exception text before adding it to events.

- [ ] **Step 5: Run orchestration and legacy rebuild tests**

Run: `pytest tests/test_resume_orchestrator.py tests/test_resume_rebuilder.py -q`

Expected: PASS; legacy endpoints retain existing behavior.

- [ ] **Step 6: Commit model orchestration**

```bash
git add ai/resume_orchestrator.py ai/resume_rebuilder.py storage/config.py tests/test_resume_orchestrator.py
git commit -m "feat: orchestrate reviewed resume generation"
```

---

### Task 5: ATS repair, cache, and idempotent generation API

**Files:**
- Modify: `ai/resume_orchestrator.py`
- Modify: `storage/repository.py`
- Modify: `api/schemas.py`
- Modify: `api/main.py`
- Modify: `tests/test_resume_orchestrator.py`
- Create: `tests/test_resume_lab_api.py`

**Interfaces:**
- Consumes: Tasks 1, 3, and 4.
- Produces: `POST /resume-lab/generate`, `GET /resume-lab/runs/{id}`, at most two targeted repairs, cache hits, and idempotent duplicate requests.

- [ ] **Step 1: Write failing repair and cache tests**

```python
def test_repairs_only_missing_supported_terms_and_stops_at_85(fake_completion):
    fake_completion.ats_scores = [72, 86]
    result = orchestrate_resume(important_request(), settings(), completion=fake_completion)
    assert fake_completion.repair_count == 1
    repair = fake_completion.last_repair
    assert repair.sections == ["SUMMARY", "TECHNICAL SKILLS", "RECENT_ROLE_1", "RECENT_ROLE_2"]
    assert "Kubernetes" not in repair.required_terms  # unsupported in source
    assert result.ats_score == 86


def test_repairs_stop_after_two_and_keep_highest_truthful_version(fake_completion):
    fake_completion.ats_scores = [71, 79, 77]
    result = orchestrate_resume(important_request(), settings(), completion=fake_completion)
    assert fake_completion.repair_count == 2
    assert result.ats_score == 79
    assert result.resume_text == fake_completion.version_with_score(79)
    assert "ATS_TARGET_NOT_REACHED" in result.event_codes


def test_generate_endpoint_reuses_completed_cache(client, fake_orchestrator):
    payload = generation_payload(idempotency_key="first")
    first = client.post("/resume-lab/generate", json=payload)
    second = client.post("/resume-lab/generate", json={**payload, "idempotency_key": "second"})
    assert first.status_code == second.status_code == 200
    assert second.json()["run_id"] == first.json()["run_id"]
    assert second.json()["events"][-1]["code"] == "CACHE_HIT"
    assert fake_orchestrator.call_count == 1
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pytest tests/test_resume_orchestrator.py tests/test_resume_lab_api.py -q`

Expected: FAIL because repair and generation endpoints are missing.

- [ ] **Step 3: Add generation schemas and repository run methods**

```python
class ResumeLabGenerateRequest(BaseModel):
    profile_id: int
    source_version: int = Field(ge=0)
    mode: Literal["HYBRID", "IMPORTANT"]
    job_description: str = Field(min_length=50)
    target_title: str | None = Field(default=None, max_length=500)
    company_name: str | None = Field(default=None, max_length=255)
    idempotency_key: str = Field(min_length=16, max_length=128)


class ResumeLabGenerateResponse(BaseModel):
    run_id: str
    status: Literal["REVIEWED", "WRITER_ONLY", "FAILED"]
    resume_text: str | None
    ats_score: int | None
    attempts: int
    events: list[GenerationEventOut]
    usage: dict[str, int]
    input_hash: str
    cache_hit: bool = False
```

Repository methods use `input_hash` and `cache_key` from normalized source/JD/title/company/mode/orchestration/model versions. `find_reviewed_resume_lab_run(cache_key)` returns only `REVIEWED` rows. `create_resume_lab_run()` catches the unique idempotency constraint and returns the existing row.

- [ ] **Step 4: Implement compact targeted repairs**

```python
best = score_candidate(reviewed_resume)
for repair_attempt in range(1, settings.resume_max_repairs + 1):
    if best.score >= settings.resume_ats_target:
        emit("ATS_TARGET_REACHED", "info", "ats", attempt=repair_attempt)
        break
    missing = [term for term in keyword_plan.supported if term not in normalize(best.text)]
    repaired_sections = completion(
        successful_reviewer,
        repair_messages(source=request.source_resume, current=best.text,
                        missing_supported=missing, editable_sections=EDITABLE_SECTIONS),
    )
    candidate = merge_repaired_sections(best.text, repaired_sections)
    validate_truth(candidate, source=request.source_resume)
    best = max(best, score_candidate(candidate), key=lambda item: item.score)
```

`merge_repaired_sections()` must reject changes outside summary, skills, and the first two roles. It must reapply the approved target titles and deterministic truth validation after every repair.

- [ ] **Step 5: Implement synchronous generation endpoint with cache and idempotency**

Validate profile/source version before any model call. Return a cache hit before calling the orchestrator. Store `WRITER_ONLY` diagnostic drafts only in `error` or a non-returned diagnostic field; never return them as `resume_text`. Persist actual provider usage when returned, otherwise a clearly labeled estimate.

- [ ] **Step 6: Run focused tests and regression suite**

Run: `pytest tests/test_resume_orchestrator.py tests/test_resume_lab_api.py tests/test_resume_rebuilder.py -q`

Expected: PASS.

- [ ] **Step 7: Commit ATS and generation API**

```bash
git add ai/resume_orchestrator.py storage/repository.py api/schemas.py api/main.py tests/test_resume_orchestrator.py tests/test_resume_lab_api.py
git commit -m "feat: add ATS-guided cached resume runs"
```

---

### Task 6: Gemini-only cover letters from reviewed runs

**Files:**
- Modify: `api/schemas.py`
- Modify: `api/main.py`
- Modify: `tests/test_resume_lab_api.py`

**Interfaces:**
- Consumes: reviewed `ResumeLabRun` from Task 5 and existing Gemini completion support.
- Produces: `POST /resume-lab/cover-letter` that accepts a reviewed run ID and current job inputs, never raw source-resume selection.

- [ ] **Step 1: Write failing cover-letter eligibility and rotation tests**

```python
def test_cover_letter_uses_reviewed_run_resume_and_rotates_gemini_keys(client, gemini):
    run = reviewed_run(content_text="NEW GENERATED RESUME", input_hash=current_input_hash())
    gemini.key(1).fails_with(429)
    gemini.key(2).returns("Dear Hiring Manager...")
    response = client.post("/resume-lab/cover-letter", json=cover_payload(run.id))
    assert response.status_code == 200
    assert gemini.calls == [1, 2]
    assert "NEW GENERATED RESUME" in gemini.last_prompt
    assert "UPLOADED ORIGINAL" not in gemini.last_prompt


def test_cover_letter_rejects_changed_inputs_before_provider_call(client, gemini):
    run = reviewed_run(input_hash="old")
    response = client.post("/resume-lab/cover-letter", json=cover_payload(run.id, company="Changed"))
    assert response.status_code == 409
    assert gemini.calls == []


def test_all_gemini_keys_failing_never_calls_paid_providers(client, gemini, paid):
    gemini.all_keys_fail_temporarily()
    response = client.post("/resume-lab/cover-letter", json=cover_payload(reviewed_run().id))
    assert response.status_code == 503
    assert paid.calls == []
```

- [ ] **Step 2: Run cover-letter tests and verify RED**

Run: `pytest tests/test_resume_lab_api.py -k cover_letter -q`

Expected: FAIL with 404 for the new endpoint.

- [ ] **Step 3: Add the run-bound request and endpoint**

```python
class ResumeLabCoverLetterRequest(BaseModel):
    run_id: str
    job_description: str = Field(min_length=50)
    target_title: str = Field(min_length=1, max_length=500)
    company_name: str | None = Field(default=None, max_length=255)


def generate_resume_lab_cover_letter(payload, session):
    run = repository.get_resume_lab_run(payload.run_id)
    if run is None or run.status != "REVIEWED" or not run.content_text:
        raise HTTPException(409, "Generate a reviewed resume before creating a cover letter.")
    current_hash = normalized_hash(run.source_hash, payload.job_description,
                                   payload.target_title, payload.company_name or "", run.mode)
    if current_hash != run.input_hash:
        raise HTTPException(409, "Resume inputs changed; generate the resume again.")
    return gemini_cover_letter_with_rotation(
        generated_resume=run.content_text,
        job_description=payload.job_description,
        target_title=payload.target_title,
        company_name=payload.company_name,
    )
```

The rotation helper iterates `settings.gemini_api_keys` only on timeout, connection, 408, 429, or 5xx. It stops immediately on invalid requests and never calls `_provider_order()`.

- [ ] **Step 4: Run cover-letter and existing document tests**

Run: `pytest tests/test_resume_lab_api.py tests/test_document_generation.py -q`

Expected: PASS.

- [ ] **Step 5: Commit Gemini-only cover letters**

```bash
git add api/schemas.py api/main.py tests/test_resume_lab_api.py
git commit -m "feat: bind cover letters to reviewed resumes"
```

---

### Task 7: Frontend contracts, migration, and eligibility state

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/types/job.ts`
- Modify: `frontend/lib/api.ts`
- Create: `frontend/lib/resume-lab-state.ts`
- Create: `frontend/lib/resume-lab-state.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5, and 6 endpoints.
- Produces: typed API functions and pure UI-state helpers used by the Resume Lab page.

- [ ] **Step 1: Add Vitest and write failing pure-state tests**

Run: `npm install --save-dev vitest`

Add `"test": "vitest run"` to scripts, then create:

```typescript
import { describe, expect, it } from "vitest";
import { canGenerateCoverLetter, shouldMigrateLocalResume } from "./resume-lab-state";

describe("Resume Lab state", () => {
  it("enables cover letter only for a reviewed run with unchanged inputs", () => {
    expect(canGenerateCoverLetter({ status: "REVIEWED", runInputHash: "same", currentInputHash: "same" })).toBe(true);
    expect(canGenerateCoverLetter({ status: "WRITER_ONLY", runInputHash: "same", currentInputHash: "same" })).toBe(false);
    expect(canGenerateCoverLetter({ status: "REVIEWED", runInputHash: "old", currentInputHash: "new" })).toBe(false);
  });

  it("migrates local resume only when VM resume is empty", () => {
    expect(shouldMigrateLocalResume("local resume", null)).toBe(true);
    expect(shouldMigrateLocalResume("local resume", "vm resume")).toBe(false);
  });
});
```

- [ ] **Step 2: Run frontend tests and verify RED**

Run: `cd frontend && npm test`

Expected: FAIL because `resume-lab-state.ts` does not exist.

- [ ] **Step 3: Add types, API clients, and pure helpers**

```typescript
export type ResumeGenerationMode = "HYBRID" | "IMPORTANT";
export type ResumeLabProfile = {
  id: number; name: string; resume_text: string | null; resume_filename: string | null;
  resume_sha256: string | null; source_version: number; updated_at: string;
};
export type ResumeGenerationEvent = {
  code: string; severity: "info" | "warning" | "error"; stage: string;
  provider: string | null; model: string | null; attempt: number;
  timestamp: string; message: string;
};
export type ResumeLabRunResult = {
  run_id: string; status: "REVIEWED" | "WRITER_ONLY" | "FAILED";
  resume_text: string | null; ats_score: number | null; attempts: number;
  events: ResumeGenerationEvent[]; usage: Record<string, number>; cache_hit: boolean;
  input_hash: string;
};

export function canGenerateCoverLetter(input: {
  status: ResumeLabRunResult["status"] | null;
  runInputHash: string | null;
  currentInputHash: string;
}) {
  return input.status === "REVIEWED" && input.runInputHash === input.currentInputHash;
}
```

Add `getResumeLabProfiles`, `createResumeLabProfile`, `saveResumeLabResume`, `removeResumeLabResume`, `generateResumeLabResume`, and `generateResumeLabCoverLetter` to `frontend/lib/api.ts`. Generation retains the existing eight-minute timeout.

- [ ] **Step 4: Run frontend tests and type checking**

Run: `cd frontend && npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit frontend contracts**

```bash
git add frontend/package.json frontend/package-lock.json frontend/types/job.ts frontend/lib/api.ts frontend/lib/resume-lab-state.ts frontend/lib/resume-lab-state.test.ts
git commit -m "feat: add Resume Lab frontend contracts"
```

---

### Task 8: Streamlined Resume Lab UI

**Files:**
- Modify: `frontend/app/resume-lab/page.tsx`
- Modify: `frontend/lib/job-profiles.ts`
- Modify: `frontend/lib/resume-lab-state.test.ts`
- Create: `frontend/app/resume-lab/page.source.test.ts`

**Interfaces:**
- Consumes: Task 7 API functions and state helpers.
- Produces: central profile selection, compact editor, two generation modes, event timeline, and strict cover-letter gating.

- [ ] **Step 1: Extend state tests and add a failing page contract test**

```typescript
it.each(["resume", "jobDescription", "targetTitle", "company", "profile", "mode"])(
  "invalidates cover letter when %s changes",
  () => {
    expect(canGenerateCoverLetter({ status: "REVIEWED", runInputHash: "before", currentInputHash: "after" })).toBe(false);
  },
);
```

Create `frontend/app/resume-lab/page.source.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("Resume Lab page contract", () => {
  it("shows the two approved modes and saved-resume removal", () => {
    expect(source).toContain("NVIDIA-First Hybrid");
    expect(source).toContain("Final Resume - Important Application");
    expect(source).toContain("Remove saved resume");
  });

  it("removes job-search preferences from Resume Lab", () => {
    expect(source).not.toContain("Target search");
    expect(source).not.toContain("Location preferences");
    expect(source).not.toContain("resumeModelChoices");
  });
});
```

- [ ] **Step 2: Run tests and verify the new UI contract fails before integration**

Run: `cd frontend && npm test`

Expected: FAIL because the approved mode labels and removal action are absent and the obsolete labels are still present.

- [ ] **Step 3: Replace browser profile state with server profiles**

```typescript
const [profiles, setProfiles] = useState<ResumeLabProfile[]>([]);
const [profileId, setProfileId] = useState<number | null>(null);
const [mode, setMode] = useState<ResumeGenerationMode>("HYBRID");
const [sourceVersion, setSourceVersion] = useState(0);
const [run, setRun] = useState<ResumeLabRunResult | null>(null);
const [runInputHash, setRunInputHash] = useState<string | null>(null);

useEffect(() => {
  void getResumeLabProfiles().then(async (serverProfiles) => {
    await migrateLocalProfilesOnlyIntoEmptyServerProfiles(serverProfiles, loadProfiles());
    const refreshed = await getResumeLabProfiles();
    setProfiles(refreshed);
    setProfileId(refreshed[0]?.id ?? null);
    setResumeText(refreshed[0]?.resume_text ?? "");
    setSourceVersion(refreshed[0]?.source_version ?? 0);
  });
}, []);
```

Attach parses the file, then immediately calls `saveResumeLabResume()`. Save profile uses the current `sourceVersion`. A 409 reloads the profile and warns that another browser changed the saved resume.

- [ ] **Step 4: Implement compact profile card and remove obsolete fields**

Use a collapsed-by-default editor with a small height (`min-h-40 max-h-72`), a filename/source-version status, and buttons in this order: Save profile, Copy resume text, Remove saved resume. Removal uses `window.confirm("Remove the saved resume from this profile? The profile will remain.")` and clears run/cover-letter state after success.

Delete Target Search and Location Preferences JSX from Resume Lab and stop importing `expandSearchTerm` or `compactLocation`. Keep `frontend/lib/job-profiles.ts` only for one-time local migration compatibility; add AI Engineer to its defaults so a browser-only legacy record has a stable name match.

- [ ] **Step 5: Add the two mode cards and generation event timeline**

```tsx
const modes = [
  { value: "HYBRID", title: "NVIDIA-First Hybrid", badge: "Default",
    description: "NVIDIA writes first. OpenRouter reviews and takes over if NVIDIA fails." },
  { value: "IMPORTANT", title: "Final Resume - Important Application", badge: "Paid",
    description: "OpenRouter writes and reviews immediately for a predictable final workflow." },
] as const;
```

Generation sends profile ID/version, current JD/title/company, mode, and `crypto.randomUUID()` as idempotency key. Render event codes with friendly labels, model/provider, attempt number, warning color, final ATS score, and actual or estimated token usage. Clear the prior cover letter before every generation.

- [ ] **Step 6: Enforce cover-letter eligibility in the UI**

Compute the current input hash whenever resume version, JD, target title, company, profile, or mode changes. The button is disabled unless `run.status === "REVIEWED"`, `run.resume_text` exists, and the hashes match. Call the new run-bound cover endpoint; never send `resumeText` as the cover-letter source.

- [ ] **Step 7: Verify frontend behavior**

Run: `cd frontend && npm test && npm run typecheck && npm run build`

Expected: all commands pass without TypeScript errors.

Run: `rg -n "Target search|Location preferences|resumeModelChoices" frontend/app/resume-lab/page.tsx`

Expected: no matches.

- [ ] **Step 8: Commit the Resume Lab UI**

```bash
git add frontend/app/resume-lab/page.tsx frontend/app/resume-lab/page.source.test.ts frontend/lib/job-profiles.ts frontend/lib/resume-lab-state.test.ts
git commit -m "feat: streamline central Resume Lab UI"
```

---

### Task 9: Full verification, model validation, and controlled deployment

**Files:**
- Modify only if verification exposes a scoped defect: files already listed above.
- Do not edit `.env` unless the user separately provides or authorizes new keys or model values.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified images and a safely deployed Resume Lab while keeping unrelated containers and schedulers running.

- [ ] **Step 1: Run the complete backend suite**

Run: `pytest -q`

Expected: all tests pass with no failures.

- [ ] **Step 2: Run complete frontend verification**

Run: `cd frontend && npm test && npm run typecheck && npm run build`

Expected: tests, type checking, and production build pass.

- [ ] **Step 3: Validate configured provider models without exposing keys**

From inside the API container, query NVIDIA and OpenRouter model catalogs using configured credentials and report only boolean key presence and whether each configured model ID is present. Do not print keys, authorization headers, or complete catalog payloads.

Expected models:

```text
NVIDIA writer: deepseek-ai/deepseek-v4-pro
OpenRouter writer: deepseek/deepseek-v4-pro
OpenRouter reviewer: qwen/qwen3.7-plus
OpenRouter fallback: moonshotai/kimi-k2.5
```

If any model is unavailable, do not enable that mode and do not substitute another paid model without user approval.

- [ ] **Step 4: Back up and inspect before deployment**

Run the existing SQLite backup utility, record the backup path, then record `docker compose ps` and current container health. Confirm the API, frontend, nginx, scheduler, and Hermes email scheduler state before changes.

Expected: a new readable backup exists; current services are documented.

- [ ] **Step 5: Build images without replacing containers**

Run: `docker compose build api frontend`

Expected: both images build successfully; running containers remain unchanged.

- [ ] **Step 6: Apply the additive database migration**

Run the migration against the mounted production database from a one-off API container after the backup. Verify the three seeded profiles through a read-only API request.

Expected: new tables exist, old tables and row counts remain intact, and `.NET Developer`, `Java Developer`, and `AI Engineer` are returned.

- [ ] **Step 7: Replace only Resume Lab application containers**

Run: `docker compose up -d --no-deps api frontend`

Expected: API and frontend are recreated and running. Nginx and scheduler are not restarted.

- [ ] **Step 8: Smoke test through the public app route**

Verify:

1. Profiles load from the VM on a fresh browser session.
2. AI Engineer exists.
3. Attach, save, reload, and remove saved resume work.
4. Target Search and Location Preferences are absent.
5. Hybrid is selected by default.
6. Cover Letter is disabled before a reviewed generation.
7. A provider test run shows redacted events and ATS attempts.
8. Changing JD disables Cover Letter immediately.
9. A Gemini cover-letter failure does not produce an OpenRouter or NVIDIA call.

- [ ] **Step 9: Confirm all services after deployment**

Run: `docker compose ps` and inspect recent API/frontend/scheduler logs for errors. Separately confirm the Hermes email scheduler remains running.

Expected: all previously running services remain running; no new unhandled exceptions, database errors, or repeated provider calls appear.

- [ ] **Step 10: Commit any verification-only fixes and report**

If no fixes were needed, make no empty commit. Report commit IDs, tests/build results, backup path, model availability, migration result, container status, and any skipped live provider call that would incur a charge.
