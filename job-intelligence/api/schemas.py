from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, field_serializer, field_validator, model_validator


class CollectRequest(BaseModel):
    search_term: str
    location: str = "United States"
    sites: list[str] = Field(default_factory=lambda: ["linkedin", "indeed"])
    results_wanted: int = Field(default=1000, ge=1, le=5000)
    country_indeed: str = "usa"
    is_remote: bool = False
    job_type: str | None = None
    hours_old: float | None = Field(default=None, gt=0)
    use_company_targets: bool = False
    company_target_limit: int = Field(default=25, ge=1, le=100)
    visa_friendly_only: bool = False
    skip_expand: bool = False

    @field_validator("country_indeed", mode="before")
    @classmethod
    def _lock_country(cls, v: str) -> str:
        return "usa"

    @field_validator("location", mode="before")
    @classmethod
    def _lock_location(cls, v: str | None) -> str:
        if not v or not v.strip():
            return "United States"
        # Reject any non-USA location strings
        usa_terms = {"united states", "usa", "us", "america", "remote", "united states of america"}
        if v.strip().lower() not in usa_terms:
            # Allow state names and city, state formats — block country names
            import re
            if re.search(r"\b(canada|uk|united kingdom|india|australia|germany|france|mexico|brazil)\b", v.lower()):
                return "United States"
        return v


class CollectResponse(BaseModel):
    search_run_id: int
    jobs_seen: int
    jobs_added: int
    warnings: list[str] = Field(default_factory=list)
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
    qualification_status: str | None = None
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
    fit_score: int = 0
    qualification_status: str = "Needs Review"
    qualification_reasons: list[str] = Field(default_factory=list)
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    trust_score: int = 0
    trust_status: str = "Review"
    trust_reasons: list[str] = Field(default_factory=list)
    application_status: str | None = None
    applied_at: datetime | None = None
    easy_apply: bool = False
    salary_display: str | None = None

    model_config = {"from_attributes": True}

    @field_serializer("first_seen_at", "last_seen_at", "applied_at")
    def _serialize_dt(self, v: datetime | None) -> str | None:
        if v is None:
            return None
        # SQLite returns naive datetimes; they are always UTC — append Z so browsers
        # parse them correctly instead of treating them as local time.
        return v.isoformat() + "Z"


class ProfileIn(BaseModel):
    target_roles: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    preferred_locations: list[str] = Field(default_factory=list)
    experience_level: str | None = None
    visa_need: str | None = None
    work_mode_preference: str | None = None
    job_type_preference: str | None = None
    excluded_keywords: list[str] = Field(default_factory=list)


class ProfileOut(ProfileIn):
    id: int
    updated_at: datetime

    model_config = {"from_attributes": True}


APPLICATION_STAGES = [
    "Saved",
    "Applied",
    "Phone Screen",
    "Technical Interview",
    "Onsite Interview",
    "Offer",
    "Accepted",
    "Rejected",
    "Withdrawn",
]


class ApplicationIn(BaseModel):
    status: str = "Applied"
    resume_text: str | None = None
    cover_letter_text: str | None = None
    notes: str | None = None


class ApplicationStageUpdate(BaseModel):
    status: str
    notes: str | None = None


class CoverLetterRequest(BaseModel):
    base_resume: str = Field(min_length=50)
    job_description: str = Field(min_length=50)
    job_title: str | None = None
    company_name: str | None = None
    provider: str | None = None
    model: str | None = None


class CoverLetterResponse(BaseModel):
    provider: str
    model: str | None
    cover_letter: str


class ApplicationOut(BaseModel):
    id: int
    job_id: int
    status: str
    applied_at: datetime | None
    resume_text: str | None
    cover_letter_text: str | None
    notes: str | None
    job: JobOut

    model_config = {"from_attributes": True}


class SavedSearchIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    filters: SearchRequest


class SavedSearchOut(BaseModel):
    id: int
    name: str
    filters: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ResumeParseRequest(BaseModel):
    filename: str
    content_base64: str


class ResumeParseResponse(BaseModel):
    filename: str
    text: str


class ResumeRebuildRequest(BaseModel):
    base_resume: str = Field(min_length=50)
    job_description: str = Field(min_length=50)
    profile_name: str | None = None
    target_title: str | None = None
    provider: str | None = None
    model: str | None = None
    refine_instruction: str | None = None


class ResumeRebuildResponse(BaseModel):
    provider: str
    model: str | None
    rebuilt_resume: str
    change_summary: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    prompt: str


class BulkRebuildRequest(BaseModel):
    job_ids: list[int] = Field(min_length=1, max_length=200)
    base_resume: str = Field(min_length=50)
    profile_name: str | None = None
    provider: str | None = None
    model: str | None = None


class BulkRebuildItemOut(BaseModel):
    job_id: int
    title: str | None
    company_name: str | None
    status: str  # "ok" | "no_jd" | "error"
    rebuilt_resume: str | None = None
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


class BulkRebuildOut(BaseModel):
    total: int
    succeeded: int
    failed: int
    rate_limited: bool
    results: list[BulkRebuildItemOut]


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


class SourceCountOut(BaseModel):
    source: str
    job_count: int


class SchedulerStatusOut(BaseModel):
    running: bool
    interval_hours: int = 1
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    last_search_run_id: int | None = None
    last_jobs_seen: int | None = None
    last_error_count: int | None = None
    last_errors: list[str] = Field(default_factory=list)
