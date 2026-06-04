from __future__ import annotations

import logging
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from analytics import AnalyticsEngine
from api.schemas import AnalyticsOut, CollectRequest, CollectResponse, CompanyOut, CompanyTargetOut, JobOut, SearchRequest
from api.services import CollectionService
from collectors import CollectionRequest
from collectors.company_targets import load_company_targets
from search import SearchEngine
from storage.config import get_settings
from storage.database import get_session, init_database
from storage.repository import JobRepository


settings = get_settings()
logging.basicConfig(level=settings.log_level)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "web"

app = FastAPI(
    title="Job Intelligence Platform",
    version="0.1.0",
    description="Standalone APIs for collecting, storing, searching, and analyzing jobs.",
)

app.mount("/static", StaticFiles(directory=WEB_ROOT), name="static")


@app.on_event("startup")
def startup() -> None:
    init_database()


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
    remote: bool | None = None,
    min_salary: float | None = None,
    max_salary: float | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    return SearchEngine(session).search(
        keyword=keyword,
        company=company,
        location=location,
        source=source,
        visa_status=visa_status,
        job_type=job_type,
        remote=remote,
        min_salary=min_salary,
        max_salary=max_salary,
        limit=limit,
        offset=offset,
    )


@app.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: int, session: Session = Depends(get_session)):
    job = JobRepository(session).get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@app.get("/companies", response_model=list[CompanyOut])
def get_companies(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    return JobRepository(session).list_companies(limit=limit, offset=offset)


@app.get("/company-targets", response_model=list[CompanyTargetOut])
def get_company_targets(limit: int = Query(default=25, ge=1, le=100)):
    return load_company_targets()[:limit]


@app.get("/analytics", response_model=AnalyticsOut)
def get_analytics(session: Session = Depends(get_session)):
    overview = AnalyticsEngine(session).overview()
    overview["hiring_velocity"] = []
    return overview


@app.post("/collect", response_model=CollectResponse)
def collect_jobs(payload: CollectRequest, session: Session = Depends(get_session)):
    request = CollectionRequest(**payload.model_dump())
    run, result = CollectionService(session).collect(request)
    return CollectResponse(search_run_id=run.id, jobs_seen=result.count, errors=result.errors)


@app.post("/refresh", response_model=CollectResponse)
def refresh_jobs(payload: CollectRequest, session: Session = Depends(get_session)):
    request = CollectionRequest(**payload.model_dump())
    run, result = CollectionService(session).collect(request)
    return CollectResponse(search_run_id=run.id, jobs_seen=result.count, errors=result.errors)


@app.post("/search", response_model=list[JobOut])
def search_jobs(payload: SearchRequest, session: Session = Depends(get_session)):
    return SearchEngine(session).search(**payload.model_dump())
