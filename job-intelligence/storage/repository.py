from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime
import math
from typing import Any

from sqlalchemy import Select, and_, func, not_, or_, select
from sqlalchemy.orm import Session

from collectors.dedup import fingerprint_job
from storage.models import ChangeType, Company, Job, JobChange, JobStatus, SearchRun, utc_now


TRACKED_JOB_FIELDS = (
    "title",
    "company_name",
    "job_url",
    "job_url_direct",
    "location",
    "description",
    "job_type",
    "is_remote",
    "date_posted",
    "interval",
    "min_amount",
    "max_amount",
    "currency",
)


class JobRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create_search_run(
        self,
        *,
        search_term: str,
        location: str | None,
        sites: list[str],
        results_wanted: int,
        started_at: datetime,
        metadata: dict[str, Any] | None = None,
    ) -> SearchRun:
        run = SearchRun(
            search_term=search_term,
            location=location,
            sites=sites,
            results_wanted=results_wanted,
            started_at=started_at,
            metadata_json=metadata or {},
        )
        self.session.add(run)
        self.session.flush()
        return run

    def complete_search_run(
        self,
        run: SearchRun,
        *,
        finished_at: datetime,
        jobs_seen: int,
        errors: list[str],
    ) -> None:
        run.finished_at = finished_at
        run.jobs_seen = jobs_seen
        run.error_count = len(errors)
        run.errors = errors
        run.status = "failed" if errors and jobs_seen == 0 else "completed"

    def upsert_jobs(self, jobs: Iterable[dict[str, Any]], search_run: SearchRun | None) -> list[Job]:
        upserted: list[Job] = []
        seen_fingerprints: set[str] = set()
        for raw_job in jobs:
            normalized = self._normalize_job(raw_job)
            fingerprint = normalized["fingerprint"]
            seen_fingerprints.add(fingerprint)
            existing = self.session.scalar(select(Job).where(Job.fingerprint == fingerprint))
            if existing is None:
                existing = self._create_job(normalized, search_run)
                self._record_change(existing, search_run, ChangeType.NEW, None, normalized)
            else:
                before = self._snapshot(existing)
                changed = self._apply_updates(existing, normalized, search_run)
                if changed:
                    self._record_change(existing, search_run, ChangeType.UPDATED, before, normalized)
            upserted.append(existing)
        return upserted

    def mark_removed_jobs(self, active_fingerprints: set[str], search_run: SearchRun) -> int:
        if not active_fingerprints:
            return 0
        removed = 0
        active_jobs = self.session.scalars(
            select(Job).where(
                and_(
                    Job.status == JobStatus.ACTIVE,
                    Job.fingerprint.not_in(active_fingerprints),
                    Job.source.in_(search_run.sites),
                )
            )
        ).all()
        for job in active_jobs:
            before = self._snapshot(job)
            job.status = JobStatus.REMOVED
            job.last_changed_at = utc_now()
            self._record_change(job, search_run, ChangeType.REMOVED, before, self._snapshot(job))
            removed += 1
        return removed

    def list_jobs(
        self,
        *,
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
        limit: int = 100,
        offset: int = 0,
    ) -> list[Job]:
        statement = self._job_filters(
            keyword=keyword,
            company=company,
            location=location,
            source=source,
            job_type=job_type,
            work_mode=work_mode,
            remote=remote,
            min_salary=min_salary,
            max_salary=max_salary,
        )
        statement = statement.order_by(Job.date_posted.desc().nullslast(), Job.last_seen_at.desc())
        if visa_status or work_mode:
            if work_mode:
                candidate_limit = max((offset + limit) * 20, 500)
                jobs = list(self.session.scalars(statement.limit(candidate_limit)))
            else:
                jobs = list(self.session.scalars(statement).all())
            if visa_status:
                jobs = [job for job in jobs if job.visa_status == visa_status]
            if work_mode:
                jobs = [job for job in jobs if job.work_mode.lower() == work_mode.lower()]
            return jobs[offset : offset + limit]
        statement = statement.limit(limit).offset(offset)
        return list(self.session.scalars(statement))

    def get_job(self, job_id: int) -> Job | None:
        return self.session.get(Job, job_id)

    def list_companies(self, *, limit: int = 100, offset: int = 0) -> list[Company]:
        return list(
            self.session.scalars(
                select(Company).order_by(Company.name.asc()).limit(limit).offset(offset)
            )
        )

    def count_jobs(self) -> int:
        return self.session.scalar(
            select(func.count(Job.id)).where(Job.status == JobStatus.ACTIVE)
        ) or 0

    def count_remote_jobs(self) -> int:
        return self.session.scalar(
            select(func.count(Job.id)).where(
                and_(Job.status == JobStatus.ACTIVE, Job.is_remote.is_(True))
            )
        ) or 0

    def count_companies(self) -> int:
        return self.session.scalar(select(func.count(Company.id))) or 0

    def company_counts(self, limit: int = 20) -> list[tuple[str, int]]:
        return list(
            self.session.execute(
                select(Job.company_name, func.count(Job.id))
                .where(Job.company_name.is_not(None))
                .group_by(Job.company_name)
                .order_by(func.count(Job.id).desc())
                .limit(limit)
            )
        )

    def location_counts(self, limit: int = 20) -> list[tuple[str, int]]:
        return list(
            self.session.execute(
                select(Job.location, func.count(Job.id))
                .where(Job.location.is_not(None))
                .group_by(Job.location)
                .order_by(func.count(Job.id).desc())
                .limit(limit)
            )
        )

    def salary_summary(self) -> dict[str, float | None]:
        row = self.session.execute(
            select(func.avg(Job.min_amount), func.avg(Job.max_amount), func.min(Job.min_amount), func.max(Job.max_amount))
        ).one()
        return {
            "average_min_salary": row[0],
            "average_max_salary": row[1],
            "lowest_min_salary": row[2],
            "highest_max_salary": row[3],
        }

    def _job_filters(
        self,
        *,
        keyword: str | None,
        company: str | None,
        location: str | None,
        source: str | None,
        job_type: str | None,
        work_mode: str | None,
        remote: bool | None,
        min_salary: float | None,
        max_salary: float | None,
    ) -> Select:
        statement = select(Job).where(Job.status == JobStatus.ACTIVE)
        if keyword:
            pattern = f"%{keyword}%"
            statement = statement.where(or_(Job.title.ilike(pattern), Job.description.ilike(pattern)))
        if company:
            statement = statement.where(Job.company_name.ilike(f"%{company}%"))
        if location:
            statement = statement.where(Job.location.ilike(f"%{location}%"))
        if source:
            statement = statement.where(Job.source == source)
        if job_type:
            if job_type == "fulltime":
                statement = statement.where(
                    or_(
                        Job.job_type.ilike("%fulltime%"),
                        Job.job_type.ilike("%full-time%"),
                        Job.job_type.ilike("%full time%"),
                        Job.job_type.ilike("%full_time%"),
                    )
                )
            else:
                statement = statement.where(Job.job_type.ilike(f"%{job_type}%"))
        if work_mode:
            mode = work_mode.lower()
            hybrid_filter = self._light_text_matches(("hybrid", "in office", "in-office", "onsite/remote", "on-site/remote"))
            remote_filter = or_(
                Job.is_remote.is_(True),
                self._light_text_matches(("remote", "work from home", "wfh")),
            )
            if mode == "remote":
                statement = statement.where(remote_filter).where(not_(hybrid_filter))
            elif mode == "hybrid":
                statement = statement.where(hybrid_filter)
            elif mode in {"on-site", "onsite"}:
                statement = statement.where(Job.is_remote.is_not(True)).where(not_(hybrid_filter))
        if remote is not None:
            statement = statement.where(Job.is_remote == remote)
        if min_salary is not None:
            statement = statement.where(or_(Job.max_amount.is_(None), Job.max_amount >= min_salary))
        if max_salary is not None:
            statement = statement.where(or_(Job.min_amount.is_(None), Job.min_amount <= max_salary))
        return statement

    @staticmethod
    def _text_matches(tokens: tuple[str, ...]):
        conditions = []
        for token in tokens:
            pattern = f"%{token}%"
            conditions.extend(
                [
                    Job.title.ilike(pattern),
                    Job.description.ilike(pattern),
                    Job.location.ilike(pattern),
                    Job.job_type.ilike(pattern),
                ]
            )
        return or_(*conditions)

    @staticmethod
    def _light_text_matches(tokens: tuple[str, ...]):
        conditions = []
        for token in tokens:
            pattern = f"%{token}%"
            conditions.extend(
                [
                    Job.title.ilike(pattern),
                    Job.location.ilike(pattern),
                    Job.job_type.ilike(pattern),
                ]
            )
        return or_(*conditions)

    def _create_job(self, normalized: dict[str, Any], search_run: SearchRun | None) -> Job:
        company = self._get_or_create_company(normalized.get("company_name"))
        job = Job(
            **{field: normalized.get(field) for field in TRACKED_JOB_FIELDS},
            fingerprint=normalized["fingerprint"],
            source=normalized["source"],
            source_job_id=normalized.get("source_job_id"),
            company=company,
            raw=normalized["raw"],
            search_run=search_run,
        )
        self.session.add(job)
        self.session.flush()
        return job

    def _apply_updates(
        self,
        job: Job,
        normalized: dict[str, Any],
        search_run: SearchRun | None,
    ) -> bool:
        changed = False
        for field in TRACKED_JOB_FIELDS:
            value = normalized.get(field)
            if getattr(job, field) != value:
                setattr(job, field, value)
                changed = True
        company = self._get_or_create_company(normalized.get("company_name"))
        if job.company != company:
            job.company = company
            changed = True
        job.status = JobStatus.ACTIVE
        job.last_seen_at = utc_now()
        job.raw = normalized["raw"]
        job.search_run = search_run
        if changed:
            job.last_changed_at = utc_now()
        return changed

    def _record_change(
        self,
        job: Job,
        search_run: SearchRun | None,
        change_type: ChangeType,
        before: dict[str, Any] | None,
        after: dict[str, Any] | None,
    ) -> None:
        self.session.add(
            JobChange(
                job=job,
                search_run=search_run,
                change_type=change_type,
                before=self._json_safe(before),
                after=self._json_safe(after),
            )
        )

    def _get_or_create_company(self, name: str | None) -> Company | None:
        if not name:
            return None
        company = self.session.scalar(select(Company).where(Company.name == name))
        if company:
            return company
        company = Company(name=name)
        self.session.add(company)
        self.session.flush()
        return company

    def _normalize_job(self, raw_job: dict[str, Any]) -> dict[str, Any]:
        company_name = raw_job.get("company") or raw_job.get("company_name")
        normalized = {
            "fingerprint": raw_job.get("fingerprint") or fingerprint_job(raw_job),
            "source": raw_job.get("site") or raw_job.get("source") or "unknown",
            "source_job_id": raw_job.get("id") or raw_job.get("job_id"),
            "title": raw_job.get("title") or "Untitled role",
            "company_name": company_name,
            "job_url": raw_job.get("job_url"),
            "job_url_direct": raw_job.get("job_url_direct"),
            "location": raw_job.get("location"),
            "description": raw_job.get("description"),
            "job_type": raw_job.get("job_type"),
            "is_remote": raw_job.get("is_remote"),
            "date_posted": self._coerce_date(raw_job.get("date_posted")),
            "interval": raw_job.get("interval"),
            "min_amount": self._coerce_float(raw_job.get("min_amount")),
            "max_amount": self._coerce_float(raw_job.get("max_amount")),
            "currency": raw_job.get("currency"),
            "raw": self._json_safe(dict(raw_job)),
        }
        return normalized

    @staticmethod
    def _snapshot(job: Job) -> dict[str, Any]:
        return JobRepository._json_safe({
            "fingerprint": job.fingerprint,
            "source": job.source,
            "source_job_id": job.source_job_id,
            **{field: getattr(job, field) for field in TRACKED_JOB_FIELDS},
        })

    @staticmethod
    def _coerce_date(value: Any) -> date | None:
        if value is None or isinstance(value, date):
            return value
        if isinstance(value, datetime):
            return value.date()
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return None

    @staticmethod
    def _coerce_float(value: Any) -> float | None:
        if value in (None, ""):
            return None
        try:
            result = float(value)
            if math.isnan(result):
                return None
            return result
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _json_safe(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: JobRepository._json_safe(item) for key, item in value.items()}
        if isinstance(value, list):
            return [JobRepository._json_safe(item) for item in value]
        if isinstance(value, (datetime, date)):
            return value.isoformat()
        if isinstance(value, float) and math.isnan(value):
            return None
        return value
