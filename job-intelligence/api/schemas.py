from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class CollectRequest(BaseModel):
    search_term: str
    location: str | None = None
    sites: list[str] = Field(default_factory=lambda: ["linkedin", "indeed"])
    results_wanted: int = Field(default=50, ge=1, le=1000)
    country_indeed: str = "usa"
    is_remote: bool = False
    hours_old: int | None = None


class CollectResponse(BaseModel):
    search_run_id: int
    jobs_seen: int
    errors: list[str]


class SearchRequest(BaseModel):
    keyword: str | None = None
    company: str | None = None
    location: str | None = None
    source: str | None = None
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
    date_posted: date | None
    interval: str | None
    min_amount: float | None
    max_amount: float | None
    currency: str | None
    visa_status: str
    status: str
    first_seen_at: datetime
    last_seen_at: datetime

    model_config = {"from_attributes": True}


class CompanyOut(BaseModel):
    id: int
    name: str
    website_url: str | None

    model_config = {"from_attributes": True}


class AnalyticsOut(BaseModel):
    trending_companies: list[dict[str, Any]]
    hiring_velocity: list[dict[str, Any]] = Field(default_factory=list)
    most_requested_skills: list[dict[str, Any]]
    location_trends: list[dict[str, Any]]
    salary_trends: dict[str, Any]
