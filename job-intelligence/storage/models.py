from __future__ import annotations

import enum
import re
from datetime import UTC, datetime

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
        text = " ".join(
            str(value or "")
            for value in (
                self.title,
                self.description,
                self.company_name,
                self.raw.get("description") if isinstance(self.raw, dict) else None,
                self.raw.get("job_function") if isinstance(self.raw, dict) else None,
                self.raw.get("skills") if isinstance(self.raw, dict) else None,
            )
        ).lower()

        if re.search(r"\b(us citizen|u\.s\. citizen|usc|green card|gc|permanent resident)\b", text):
            return "USC/GC required"
        if re.search(r"\b(no sponsorship|unable to sponsor|not sponsor|without sponsorship)\b", text):
            return "No sponsorship"
        if re.search(r"\b(h-?1b|h1-b|h1b)\b", text):
            return "H1B required"
        if re.search(r"\btn visa\b|\btn status\b|\btn eligible\b", text):
            return "TN visa"
        if re.search(r"\b(visa sponsorship|sponsorship available|will sponsor)\b", text):
            return "Sponsorship available"
        return "Not specified"


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
