from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class CollectRequest(BaseModel):
    search_term: str
    location: str | None = None
    sites: list[str] = Field(default_factory=lambda: ["linkedin", "indeed"])
    results_wanted: int = Field(default=100, ge=1, le=1000)
    country_indeed: str = "usa"
    is_remote: bool = False
    job_type: str | None = None
    hours_old: float | None = Field(default=None, gt=0)
    use_company_targets: bool = False
    company_target_limit: int = Field(default=25, ge=1, le=100)
    visa_friendly_only: bool = False


class CollectResponse(BaseModel):
    search_run_id: int
    jobs_seen: int
    errors: list[str]


class SearchRequest(BaseModel):
    keyword: str | None = None
    company: str | None = None
    location: str | None = None
    source: str | None = None
    visa_status: str | None = None
    job_type: str | None = None
    work_mode: str | None = None
    remote: bool | None = None
    min_salary: float | None = None
    max_salary: float | None = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


class JobOut(BaseModel):
    id: int
    source: str
    source_job_id: str | None
    title: str
    company_name: str | None
    job_url: str | None
    location: str | None
    description: str | None
    job_type: str | None
    is_remote: bool | None
    work_mode: str
    date_posted: date | None
    interval: str | None
    min_amount: float | None
    max_amount: float | None
    currency: str | None
    visa_status: str
    visa_score: str
    apply_priority: str
    status: str
    first_seen_at: datetime
    last_seen_at: datetime

    model_config = {"from_attributes": True}


class CompanyOut(BaseModel):
    id: int
    name: str
    website_url: str | None

    model_config = {"from_attributes": True}


class CompanyTargetOut(BaseModel):
    rank: int
    company: str
    sector: str | None
    h1b_or_funding: str | None
    avg_salary: str | None
    sponsor_status: str | None
    career_url: str | None


class AnalyticsOut(BaseModel):
    trending_companies: list[dict[str, Any]]
    hiring_velocity: list[dict[str, Any]] = Field(default_factory=list)
    most_requested_skills: list[dict[str, Any]]
    location_trends: list[dict[str, Any]]
    salary_trends: dict[str, Any]


class StatsOut(BaseModel):
    total_jobs: int
    remote_jobs: int
    companies: int


class SchedulerStatusOut(BaseModel):
    running: bool
    interval_hours: int = 1
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    last_search_run_id: int | None = None
    last_jobs_seen: int | None = None
    last_error_count: int | None = None
    last_errors: list[str] = Field(default_factory=list)
