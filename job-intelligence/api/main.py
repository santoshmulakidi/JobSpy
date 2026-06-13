from __future__ import annotations

import asyncio
import base64
import io
import logging
import time
from pathlib import Path
import zipfile
from xml.etree import ElementTree

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from analytics import AnalyticsEngine
from ai import rebuild_resume
from api.schemas import (
    AnalyticsOut,
    ApplicationIn,
    ApplicationOut,
    BulkRebuildOut,
    BulkRebuildRequest,
    CollectRequest,
    CollectResponse,
    CompanyOut,
    CompanyTargetOut,
    JobOut,
    ProfileIn,
    ProfileOut,
    ResumeParseRequest,
    ResumeParseResponse,
    ResumeRebuildRequest,
    ResumeRebuildResponse,
    SavedSearchIn,
    SavedSearchOut,
    SchedulerStatusOut,
    SearchRequest,
    SourceCountOut,
    StatsOut,
)
from api.services import CollectionService
from collectors import CollectionRequest
from collectors.company_targets import load_company_targets
from scheduler.hourly import hourly_refresh_scheduler
from search import SearchEngine
from storage.backups import backup_sqlite_database
from storage.config import get_settings
from storage.database import SessionLocal, get_session, init_database
from storage.models import Application, ChangeType, UserProfile
from storage.repository import JobRepository
from search.scoring import score_job
from search.trust import score_trust


settings = get_settings()
logging.basicConfig(level=settings.log_level)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "web"

app = FastAPI(
    title="Job Intelligence Platform",
    version="0.1.0",
    description="Standalone APIs for collecting, storing, searching, and analyzing jobs.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=WEB_ROOT), name="static")


async def _lifecycle_loop() -> None:
    """Run job lifecycle once per hour in the background."""
    log = logging.getLogger(__name__)
    while True:
        session = SessionLocal()
        try:
            backup_path = backup_sqlite_database(settings.database_url, cwd=PROJECT_ROOT)
            if backup_path:
                log.info("lifecycle: SQLite backup created at %s", backup_path)
            lifecycle = JobRepository(session).apply_job_lifecycle(active_hours=24, retention_days=7)
            if lifecycle["archived"] or lifecycle["deleted"]:
                session.commit()
                log.info("lifecycle: archived=%d deleted=%d", lifecycle["archived"], lifecycle["deleted"])
        except Exception:
            session.rollback()
            log.exception("lifecycle run failed")
        finally:
            session.close()
        await asyncio.sleep(3600)



def _job_out(
    repository: JobRepository,
    job,
    *,
    profile: UserProfile | None = None,
    application: Application | None = None,
) -> JobOut:
    profile = profile or repository.get_profile()
    score = score_job(job, profile)
    trust = score_trust(job)
    if application is None:
        application = repository.get_application_for_job(job.id)
    return JobOut(
        id=job.id,
        source=job.source,
        source_job_id=job.source_job_id,
        title=job.title,
        company_name=job.company_name,
        job_url=job.job_url,
        location=job.location,
        description=job.description,
        job_type=job.job_type,
        is_remote=job.is_remote,
        work_mode=job.work_mode,
        date_posted=job.date_posted,
        interval=job.interval,
        min_amount=job.min_amount,
        max_amount=job.max_amount,
        currency=job.currency,
        visa_status=job.visa_status,
        visa_score=job.visa_score,
        apply_priority=job.apply_priority,
        status=job.status,
        first_seen_at=job.first_seen_at,
        last_seen_at=job.last_seen_at,
        fit_score=score.fit_score,
        qualification_status=score.qualification_status,
        qualification_reasons=score.qualification_reasons,
        matched_skills=score.matched_skills,
        missing_skills=score.missing_skills,
        trust_score=trust.trust_score,
        trust_status=trust.trust_status,
        trust_reasons=trust.trust_reasons,
        application_status=application.status if application else None,
        applied_at=application.applied_at if application else None,
    )


def _jobs_out(repository: JobRepository, jobs) -> list[JobOut]:
    job_list = list(jobs)
    profile = repository.get_profile()
    applications = repository.applications_for_jobs(job.id for job in job_list)
    return [
        _job_out(repository, job, profile=profile, application=applications.get(job.id))
        for job in job_list
    ]


def _split_collection_messages(messages: list[str]) -> tuple[list[str], list[str]]:
    warning_markers = (
        "returned no matching jobs",
        "requires JOB_INTELLIGENCE_USAJOBS_API_KEY",
        "career page request failed: 400 Client Error",
    )
    warnings: list[str] = []
    errors: list[str] = []
    for message in messages:
        if any(marker in message for marker in warning_markers):
            warnings.append(message)
        else:
            errors.append(message)
    return warnings, errors


def _collect_response(repository: JobRepository, run, result) -> CollectResponse:
    warnings, errors = _split_collection_messages(result.errors)
    jobs_added = repository.count_job_changes(run.id, ChangeType.NEW)
    return CollectResponse(
        search_run_id=run.id,
        jobs_seen=result.count,
        jobs_added=jobs_added,
        warnings=warnings,
        errors=errors,
    )


def _extract_docx_text(content: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            xml = archive.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=400, detail="Could not read DOCX document text") from exc

    root = ElementTree.fromstring(xml)
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs: list[str] = []
    for paragraph in root.iter(f"{namespace}p"):
        text = "".join(node.text or "" for node in paragraph.iter(f"{namespace}t"))
        text = " ".join(text.split())
        if text:
            paragraphs.append(text)
    return "\n".join(paragraphs)


@app.on_event("startup")
async def startup() -> None:
    init_database()
    asyncio.create_task(_lifecycle_loop())


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def dashboard() -> FileResponse:
    return FileResponse(WEB_ROOT / "index.html")


@app.get("/admin", include_in_schema=False)
def admin_dashboard() -> FileResponse:
    return FileResponse(WEB_ROOT / "admin.html")


@app.get("/jobs", response_model=list[JobOut])
def get_jobs(
    keyword: str | None = None,
    company: str | None = None,
    location: str | None = None,
    source: str | None = None,
    visa_status: str | None = None,
    job_type: str | None = None,
    work_mode: str | None = None,
    remote: bool | None = None,
    min_salary: float | None = None,
    max_salary: float | None = None,
    qualification_status: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    repository = JobRepository(session)
    jobs = SearchEngine(session).search(
        keyword=keyword,
        company=company,
        location=location,
        source=source,
        visa_status=visa_status,
        job_type=job_type,
        work_mode=work_mode,
        remote=remote,
        min_salary=min_salary,
        max_salary=max_salary,
        qualification_status=qualification_status,
        limit=limit,
        offset=offset,
    )
    return _jobs_out(repository, jobs)


@app.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: int, session: Session = Depends(get_session)):
    repository = JobRepository(session)
    job = repository.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return _job_out(repository, job)


@app.get("/profile", response_model=ProfileOut)
def get_profile(session: Session = Depends(get_session)):
    return JobRepository(session).get_profile()


@app.put("/profile", response_model=ProfileOut)
def update_profile(payload: ProfileIn, session: Session = Depends(get_session)):
    repository = JobRepository(session)
    profile = repository.update_profile(payload.model_dump())
    session.commit()
    return profile


@app.get("/applications", response_model=list[ApplicationOut])
def get_applications(session: Session = Depends(get_session)):
    repository = JobRepository(session)
    return [
        ApplicationOut(
            id=application.id,
            job_id=application.job_id,
            status=application.status,
            applied_at=application.applied_at,
            resume_text=application.resume_text,
            cover_letter_text=application.cover_letter_text,
            notes=application.notes,
            job=_job_out(repository, application.job),
        )
        for application in repository.list_applications()
    ]


@app.post("/jobs/{job_id}/apply", response_model=ApplicationOut)
def mark_job_applied(job_id: int, payload: ApplicationIn, session: Session = Depends(get_session)):
    repository = JobRepository(session)
    job = repository.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    application = repository.upsert_application(job_id=job_id, **payload.model_dump())
    session.commit()
    return ApplicationOut(
        id=application.id,
        job_id=application.job_id,
        status=application.status,
        applied_at=application.applied_at,
        resume_text=application.resume_text,
        cover_letter_text=application.cover_letter_text,
        notes=application.notes,
        job=_job_out(repository, job),
    )


@app.post("/resume/parse", response_model=ResumeParseResponse)
def parse_resume(payload: ResumeParseRequest):
    try:
        content = base64.b64decode(payload.content_base64)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Resume file content is not valid base64") from exc

    filename = payload.filename.lower()
    if filename.endswith(".docx"):
        text = _extract_docx_text(content)
    elif filename.endswith(".txt"):
        text = content.decode("utf-8", errors="ignore")
    else:
        raise HTTPException(status_code=400, detail="Only DOCX and TXT resume uploads are supported right now")

    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="No readable resume text found")
    return ResumeParseResponse(filename=payload.filename, text=text)


@app.post("/resume/rebuild", response_model=ResumeRebuildResponse)
def rebuild_resume_endpoint(payload: ResumeRebuildRequest):
    result = rebuild_resume(
        base_resume=payload.base_resume,
        job_description=payload.job_description,
        profile_name=payload.profile_name,
        target_title=payload.target_title,
        provider=payload.provider,
        model=payload.model,
        refine_instruction=payload.refine_instruction,
        settings=settings,
    )
    return ResumeRebuildResponse(
        provider=result.provider,
        model=result.model,
        rebuilt_resume=result.rebuilt_resume,
        change_summary=result.change_summary,
        warnings=result.warnings,
        prompt=result.prompt,
    )


@app.post("/resume/export-docx")
def export_resume_docx(payload: dict):
    from ai.resume_docx import build_resume_docx

    resume_text = (payload.get("resume_text") or "").strip()
    if len(resume_text) < 50:
        raise HTTPException(status_code=422, detail="resume_text must be at least 50 characters")
    filename = (payload.get("filename") or "resume").strip() or "resume"
    filename = "".join(c for c in filename if c.isalnum() or c in "-_ ").strip() or "resume"
    docx_bytes = build_resume_docx(resume_text, candidate_name=payload.get("candidate_name"))
    downloads_path = Path.home() / "Downloads" / f"{filename}.docx"
    try:
        downloads_path.write_bytes(docx_bytes)
    except OSError:
        downloads_path = Path("")
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}.docx"',
            "X-Saved-To": str(downloads_path),
        },
    )


@app.post("/resume/bulk-rebuild", response_model=BulkRebuildOut)
def bulk_rebuild_resume(payload: BulkRebuildRequest, session: Session = Depends(get_session)):
    log = logging.getLogger(__name__)
    repository = JobRepository(session)
    results = []
    succeeded = 0
    failed = 0
    rate_limited = False

    # 4 seconds between calls = 15 RPM, safe for Gemini free tier
    delay_seconds = 4.0

    for job_id in payload.job_ids:
        job = repository.get_job(job_id)
        if job is None:
            results.append({"job_id": job_id, "title": None, "company_name": None,
                            "status": "error", "error": "job not found"})
            failed += 1
            continue

        jd = (job.description or "").strip()
        target = f"{job.title or 'Software Engineer'}{' at ' + job.company_name if job.company_name else ''}{' | ' + job.location if job.location else ''}"

        try:
            result = rebuild_resume(
                base_resume=payload.base_resume,
                job_description=jd,
                profile_name=payload.profile_name,
                target_title=target,
                provider=payload.provider,
                model=payload.model,
                settings=settings,
            )

            if result.provider == "prompt_only":
                rate_limited = True
                results.append({
                    "job_id": job_id,
                    "title": job.title,
                    "company_name": job.company_name,
                    "status": "error",
                    "error": "; ".join(result.warnings) or "All providers rate limited or unavailable",
                })
                failed += 1
            else:
                status = "no_jd" if not jd else "ok"
                results.append({
                    "job_id": job_id,
                    "title": job.title,
                    "company_name": job.company_name,
                    "status": status,
                    "rebuilt_resume": result.rebuilt_resume,
                    "warnings": result.warnings,
                })
                succeeded += 1

        except Exception as exc:
            log.exception("bulk rebuild failed for job %d", job_id)
            results.append({
                "job_id": job_id,
                "title": job.title,
                "company_name": job.company_name,
                "status": "error",
                "error": str(exc),
            })
            failed += 1

        if job_id != payload.job_ids[-1]:
            time.sleep(delay_seconds)

    return BulkRebuildOut(
        total=len(payload.job_ids),
        succeeded=succeeded,
        failed=failed,
        rate_limited=rate_limited,
        results=results,
    )


@app.get("/saved-searches", response_model=list[SavedSearchOut])
def get_saved_searches(session: Session = Depends(get_session)):
    return JobRepository(session).list_saved_searches()


@app.post("/saved-searches", response_model=SavedSearchOut)
def create_saved_search(payload: SavedSearchIn, session: Session = Depends(get_session)):
    repository = JobRepository(session)
    saved_search = repository.create_saved_search(
        name=payload.name.strip(),
        filters=payload.filters.model_dump(),
    )
    session.commit()
    return saved_search


@app.delete("/saved-searches/{saved_search_id}")
def delete_saved_search(saved_search_id: int, session: Session = Depends(get_session)):
    deleted = JobRepository(session).delete_saved_search(saved_search_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="saved search not found")
    session.commit()
    return {"status": "deleted"}


@app.get("/companies", response_model=list[CompanyOut])
def get_companies(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    return JobRepository(session).list_companies(limit=limit, offset=offset)


@app.get("/company-targets", response_model=list[CompanyTargetOut])
def get_company_targets(limit: int = Query(default=100, ge=1, le=500)):
    return load_company_targets()[:limit]


@app.get("/analytics", response_model=AnalyticsOut)
def get_analytics(session: Session = Depends(get_session)):
    overview = AnalyticsEngine(session).overview()
    overview["hiring_velocity"] = []
    return overview


@app.get("/stats", response_model=StatsOut)
def get_stats(session: Session = Depends(get_session)):
    repository = JobRepository(session)
    return StatsOut(
        total_jobs=repository.count_jobs(),
        remote_jobs=repository.count_remote_jobs(),
        companies=repository.count_companies(),
    )


@app.get("/source-counts", response_model=list[SourceCountOut])
def get_source_counts(session: Session = Depends(get_session)):
    repository = JobRepository(session)
    return [
        SourceCountOut(source=source, job_count=job_count)
        for source, job_count in repository.source_counts()
    ]


@app.post("/collect", response_model=CollectResponse)
def collect_jobs(payload: CollectRequest, session: Session = Depends(get_session)):
    request = CollectionRequest(**payload.model_dump())
    run, result = CollectionService(session).collect(request)
    repository = JobRepository(session)
    return _collect_response(repository, run, result)


@app.post("/refresh", response_model=CollectResponse)
def refresh_jobs(payload: CollectRequest, session: Session = Depends(get_session)):
    request = CollectionRequest(**payload.model_dump())
    run, result = CollectionService(session).collect(request)
    repository = JobRepository(session)
    return _collect_response(repository, run, result)


@app.post("/search", response_model=list[JobOut])
def search_jobs(payload: SearchRequest, session: Session = Depends(get_session)):
    repository = JobRepository(session)
    return _jobs_out(repository, SearchEngine(session).search(**payload.model_dump()))


@app.get("/scheduler/status", response_model=SchedulerStatusOut)
def scheduler_status():
    return hourly_refresh_scheduler.status()


@app.post("/scheduler/start", response_model=SchedulerStatusOut)
def scheduler_start(payload: CollectRequest):
    request = CollectionRequest(**payload.model_dump())
    return hourly_refresh_scheduler.start(request)


@app.post("/scheduler/stop", response_model=SchedulerStatusOut)
def scheduler_stop():
    return hourly_refresh_scheduler.stop()
