from __future__ import annotations

import enum
import re
from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class JobStatus(str, enum.Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    REMOVED = "removed"


class ChangeType(str, enum.Enum):
    NEW = "new"
    UPDATED = "updated"
    REMOVED = "removed"


def utc_now() -> datetime:
    return datetime.now(UTC)


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    website_url: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    jobs: Mapped[list["Job"]] = relationship(back_populates="company")


class SearchRun(Base):
    __tablename__ = "search_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    search_term: Mapped[str] = mapped_column(String(255), index=True)
    location: Mapped[str | None] = mapped_column(String(255), index=True)
    sites: Mapped[list[str]] = mapped_column(JSON)
    results_wanted: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(40), default="completed")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    jobs_seen: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[list[str]] = mapped_column(JSON, default=list)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)

    jobs: Mapped[list["Job"]] = relationship(back_populates="search_run")
    changes: Mapped[list["JobChange"]] = relationship(back_populates="search_run")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        UniqueConstraint("fingerprint", name="uq_jobs_fingerprint"),
        Index("ix_jobs_search", "title", "location", "is_remote"),
        Index("ix_jobs_salary", "min_amount", "max_amount"),
        Index("ix_jobs_active_feed", "status", "date_posted", "last_seen_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(80), index=True)
    source_job_id: Mapped[str | None] = mapped_column(String(255), index=True)
    title: Mapped[str] = mapped_column(String(500), index=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"))
    company_name: Mapped[str | None] = mapped_column(String(255), index=True)
    job_url: Mapped[str | None] = mapped_column(String(2000))
    job_url_direct: Mapped[str | None] = mapped_column(String(2000))
    location: Mapped[str | None] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    job_type: Mapped[str | None] = mapped_column(String(255))
    is_remote: Mapped[bool | None] = mapped_column(Boolean, index=True)
    date_posted: Mapped[datetime | None] = mapped_column(Date)
    interval: Mapped[str | None] = mapped_column(String(40))
    min_amount: Mapped[float | None] = mapped_column(Float)
    max_amount: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str | None] = mapped_column(String(12))
    status: Mapped[JobStatus] = mapped_column(
        Enum(JobStatus),
        default=JobStatus.ACTIVE,
        index=True,
    )
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    raw: Mapped[dict] = mapped_column(JSON, default=dict)
    search_run_id: Mapped[int | None] = mapped_column(ForeignKey("search_runs.id"))

    company: Mapped[Company | None] = relationship(back_populates="jobs")
    search_run: Mapped[SearchRun | None] = relationship(back_populates="jobs")
    changes: Mapped[list["JobChange"]] = relationship(back_populates="job")

    @property
    def visa_status(self) -> str:
        text = self._visa_text()

        if re.search(
            r"\b(us citizen|u\.s\. citizen|u\.s citizen|usc|green card|gc-ead|gc ead|"
            r"permanent resident)\b",
            text,
        ):
            return "USC/GC required"
        if re.search(r"\b(w2 only|w-2 only|only w2|only w-2)\b", text):
            return "W2 only"
        if re.search(
            r"\b(no sponsorship|no visa sponsorship|unable to sponsor|cannot sponsor|"
            r"unable to offer employment sponsorship|"
            r"will not sponsor|not eligible for visa sponsorship|visa sponsorship not available|"
            r"sponsorship not available|does not offer employment sponsorship|"
            r"does not anticipate providing sponsorship|without the need for employer sponsorship|"
            r"without employer sponsorship|without sponsorship|do not sponsor|does not sponsor|"
            r"not sponsor applicants|unable to sponsor h-?1b|unable to sponsor h1b|"
            r"work authorization that does not now or in the future require sponsorship|"
            r"does not intend to hire .* need .* sponsorship)\b",
            text,
        ):
            return "No sponsorship"
        if re.search(r"\b(no c2c|no c-2-c|no corp(?:oration)? to corp(?:oration)?|no third parties)\b", text):
            return "No C2C"
        if re.search(r"\b(c2c|c-2-c|corp(?:oration)? to corp(?:oration)?)\b", text):
            return "C2C accepted"
        if re.search(r"\b(limited immigration sponsorship may be available|sponsorship may be available|"
                     r"sponsorship available|will sponsor|visa sponsorship available)\b", text):
            return "Sponsorship available"
        if re.search(r"\b(h-?1b|h1-b|h1b|h4-ead|h4 ead)\b", text):
            return "H1B accepted"
        if re.search(r"\btn visa\b|\btn status\b|\btn eligible\b", text):
            return "TN visa"
        if re.search(r"\b(opt-ead|opt ead|cpt|f-1|f1)\b", text):
            return "OPT/CPT accepted"
        if re.search(
            r"\b(authorized to work in the united states|authorized to work in the us|"
            r"work authorization|legally authorized to work)\b",
            text,
        ):
            return "Work authorization required"
        return "Not specified"

    @property
    def visa_score(self) -> str:
        status = self.visa_status
        text = self._visa_text()
        high_signal_sources = {"jobright_h1b", "visafriendly", "jobsh1b"}

        if self.source in high_signal_sources:
            return "High"
        if status in {
            "C2C accepted",
            "H1B accepted",
            "OPT/CPT accepted",
            "Sponsorship available",
            "TN visa",
        }:
            return "High"
        if re.search(r"\b(strong sponsor|active sponsor|visa friendly|h1b sponsor|h-?1b sponsor)\b", text):
            return "High"
        if status in {"No C2C", "No sponsorship", "USC/GC required", "W2 only"}:
            return "Low"
        if status == "Work authorization required" or re.search(r"\b(h-?1b|tn visa|sponsor|visa)\b", text):
            return "Medium"
        return "Unknown"

    @property
    def work_mode(self) -> str:
        text = self._visa_text()
        if re.search(r"\b(hybrid|onsite/remote|on-site/remote|in office|in-office)\b", text):
            return "Hybrid"
        if self.is_remote or re.search(r"\b(remote|work from home|wfh)\b", text):
            return "Remote"
        return "On-site"

    @property
    def apply_priority(self) -> str:
        score = self.visa_score
        posted = self.date_posted
        if isinstance(posted, datetime):
            posted = posted.date()

        fresh_days = None
        if isinstance(posted, date):
            fresh_days = max(0, (date.today() - posted).days)

        if score == "High" and (fresh_days is None or fresh_days <= 7):
            return "High"
        if score == "High" or (score == "Medium" and (fresh_days is None or fresh_days <= 14)):
            return "Medium"
        return "Low"

    def _visa_text(self) -> str:
        values = [
            self.title,
            self.description,
            self.company_name,
            self.location,
            self.job_type,
            self.source,
        ]
        if isinstance(self.raw, dict):
            values.append(self._flatten_for_visa(self.raw))
        text = " ".join(str(value or "") for value in values).lower()
        return re.sub(r"\s+", " ", text)

    @classmethod
    def _flatten_for_visa(cls, value) -> str:
        if isinstance(value, dict):
            return " ".join(cls._flatten_for_visa(item) for item in value.values())
        if isinstance(value, list):
            return " ".join(cls._flatten_for_visa(item) for item in value)
        return str(value or "")


class JobChange(Base):
    __tablename__ = "job_changes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"), index=True)
    search_run_id: Mapped[int | None] = mapped_column(ForeignKey("search_runs.id"), index=True)
    change_type: Mapped[ChangeType] = mapped_column(Enum(ChangeType), index=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    before: Mapped[dict | None] = mapped_column(JSON)
    after: Mapped[dict | None] = mapped_column(JSON)

    job: Mapped[Job] = relationship(back_populates="changes")
    search_run: Mapped[SearchRun | None] = relationship(back_populates="changes")


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    preferred_locations: Mapped[list[str]] = mapped_column(JSON, default=list)
    experience_level: Mapped[str | None] = mapped_column(String(120))
    visa_need: Mapped[str | None] = mapped_column(String(120))
    work_mode_preference: Mapped[str | None] = mapped_column(String(80))
    job_type_preference: Mapped[str | None] = mapped_column(String(80))
    excluded_keywords: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (UniqueConstraint("job_id", name="uq_applications_job_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"), index=True)
    status: Mapped[str] = mapped_column(String(80), default="Applied", index=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utc_now)
    resume_text: Mapped[str | None] = mapped_column(Text)
    cover_letter_text: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    job: Mapped[Job] = relationship()


class SavedSearch(Base):
    __tablename__ = "saved_searches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    filters: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )
