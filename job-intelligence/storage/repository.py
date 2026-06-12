from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timedelta
import math
import re
from typing import Any

from sqlalchemy import Select, and_, delete, exists, func, not_, or_, select
from sqlalchemy.orm import Session

from collectors.dedup import fingerprint_job
from storage.models import (
    Application,
    ChangeType,
    Company,
    Job,
    JobChange,
    JobStatus,
    SavedSearch,
    SearchRun,
    UserProfile,
    utc_now,
)


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

    def apply_job_lifecycle(self, *, active_hours: int = 24, retention_days: int = 7) -> dict[str, int]:
        """Keep the active feed fresh while preserving applied job history."""
        archived = self.archive_stale_jobs(active_hours=active_hours)
        deleted = self.delete_expired_jobs(retention_days=retention_days)
        return {"archived": archived, "deleted": deleted}

    def archive_stale_jobs(self, *, active_hours: int = 24) -> int:
        cutoff = utc_now() - timedelta(hours=active_hours)
        jobs = self.session.scalars(
            select(Job).where(
                and_(
                    Job.status == JobStatus.ACTIVE,
                    Job.first_seen_at < cutoff,
                )
            )
        ).all()
        for job in jobs:
            job.status = JobStatus.ARCHIVED
            job.last_changed_at = utc_now()
        if jobs:
            self.session.flush()
        return len(jobs)

    def delete_expired_jobs(self, *, retention_days: int = 7) -> int:
        cutoff = utc_now() - timedelta(days=retention_days)
        applied_job_exists = exists().where(Application.job_id == Job.id)
        jobs = self.session.scalars(
            select(Job).where(
                and_(
                    Job.first_seen_at < cutoff,
                    not_(applied_job_exists),
                )
            )
        ).all()
        deleted = len(jobs)
        job_ids = [job.id for job in jobs]
        if job_ids:
            self.session.execute(delete(JobChange).where(JobChange.job_id.in_(job_ids)))
        for job in jobs:
            self.session.delete(job)
        if deleted:
            self.session.flush()
        return deleted

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

    def get_profile(self) -> UserProfile:
        profile = self.session.get(UserProfile, 1)
        if profile:
            return profile
        profile = UserProfile(
            id=1,
            target_roles=[".NET Developer", "Java Developer", "Software Engineer"],
            skills=["C#", ".NET", "Java", "SQL", "AWS", "React", "API"],
            preferred_locations=["Dallas", "Remote", "United States"],
            experience_level="Senior",
            visa_need="H1B/TN/GC friendly",
            work_mode_preference="Remote or Hybrid",
            job_type_preference="Full-time",
            excluded_keywords=["C2C", "USC only", "no sponsorship"],
        )
        self.session.add(profile)
        self.session.flush()
        return profile

    def update_profile(self, values: dict[str, Any]) -> UserProfile:
        profile = self.get_profile()
        for field in (
            "target_roles",
            "skills",
            "preferred_locations",
            "experience_level",
            "visa_need",
            "work_mode_preference",
            "job_type_preference",
            "excluded_keywords",
        ):
            if field in values:
                setattr(profile, field, values[field])
        profile.updated_at = utc_now()
        self.session.flush()
        return profile

    def list_applications(self) -> list[Application]:
        return list(
            self.session.scalars(
                select(Application).order_by(Application.applied_at.desc().nullslast(), Application.id.desc())
            )
        )

    def get_application_for_job(self, job_id: int) -> Application | None:
        return self.session.scalar(select(Application).where(Application.job_id == job_id))

    def applications_for_jobs(self, job_ids: Iterable[int]) -> dict[int, Application]:
        ids = list(job_ids)
        if not ids:
            return {}
        applications = self.session.scalars(
            select(Application).where(Application.job_id.in_(ids))
        ).all()
        return {application.job_id: application for application in applications}

    def upsert_application(
        self,
        *,
        job_id: int,
        status: str = "Applied",
        resume_text: str | None = None,
        cover_letter_text: str | None = None,
        notes: str | None = None,
    ) -> Application:
        application = self.get_application_for_job(job_id)
        if application is None:
            application = Application(job_id=job_id, applied_at=utc_now())
            self.session.add(application)
        job = self.session.get(Job, job_id)
        if job:
            job.status = JobStatus.ARCHIVED
            job.last_changed_at = utc_now()
        application.status = status
        application.resume_text = resume_text
        application.cover_letter_text = cover_letter_text
        application.notes = notes
        application.updated_at = utc_now()
        self.session.flush()
        return application

    def list_saved_searches(self) -> list[SavedSearch]:
        return list(
            self.session.scalars(
                select(SavedSearch).order_by(SavedSearch.updated_at.desc(), SavedSearch.id.desc())
            )
        )

    def create_saved_search(self, *, name: str, filters: dict[str, Any]) -> SavedSearch:
        saved_search = SavedSearch(name=name, filters=filters)
        self.session.add(saved_search)
        self.session.flush()
        return saved_search

    def delete_saved_search(self, saved_search_id: int) -> bool:
        saved_search = self.session.get(SavedSearch, saved_search_id)
        if saved_search is None:
            return False
        self.session.delete(saved_search)
        self.session.flush()
        return True

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

    def source_counts(self) -> list[tuple[str, int]]:
        return list(
            self.session.execute(
                select(Job.source, func.count(Job.id))
                .where(and_(Job.status == JobStatus.ACTIVE, Job.source.is_not(None)))
                .group_by(Job.source)
                .order_by(func.count(Job.id).desc())
            )
        )

    def count_job_changes(self, search_run_id: int, change_type: ChangeType) -> int:
        return self.session.scalar(
            select(func.count(JobChange.id)).where(
                and_(
                    JobChange.search_run_id == search_run_id,
                    JobChange.change_type == change_type,
                )
            )
        ) or 0

    def company_counts(self, limit: int = 20) -> list[tuple[str, int]]:
        return list(
            self.session.execute(
                select(Job.company_name, func.count(Job.id))
                .where(and_(Job.status == JobStatus.ACTIVE, Job.company_name.is_not(None)))
                .group_by(Job.company_name)
                .order_by(func.count(Job.id).desc())
                .limit(limit)
            )
        )

    def location_counts(self, limit: int = 20) -> list[tuple[str, int]]:
        return list(
            self.session.execute(
                select(Job.location, func.count(Job.id))
                .where(and_(Job.status == JobStatus.ACTIVE, Job.location.is_not(None)))
                .group_by(Job.location)
                .order_by(func.count(Job.id).desc())
                .limit(limit)
            )
        )

    def salary_summary(self) -> dict[str, float | None]:
        row = self.session.execute(
            select(func.avg(Job.min_amount), func.avg(Job.max_amount), func.min(Job.min_amount), func.max(Job.max_amount))
            .where(Job.status == JobStatus.ACTIVE)
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
            keyword_conditions = []
            for term in self._expanded_keyword_terms(keyword):
                pattern = f"%{term}%"
                keyword_conditions.extend([Job.title.ilike(pattern), Job.description.ilike(pattern)])
            if keyword_conditions:
                statement = statement.where(or_(*keyword_conditions))
        if company:
            statement = statement.where(Job.company_name.ilike(f"%{company}%"))
        if location:
            location_conditions = []
            for term in self._expanded_location_terms(location):
                location_conditions.append(Job.location.ilike(f"%{term}%"))
            if location_conditions:
                statement = statement.where(or_(*location_conditions))
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
            elif job_type == "c2c":
                statement = statement.where(self._text_matches(("c2c", "corp-to-corp", "corp to corp")))
            elif job_type == "w2":
                statement = statement.where(self._text_matches(("w2", "w-2")))
            elif job_type == "contract":
                statement = statement.where(self._text_matches(("contract", "contractor", "contract-to-hire", "contract to hire")))
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
    def _expanded_keyword_terms(keyword: str) -> list[str]:
        terms = [
            term.strip().strip('"')
            for term in re.split(r"\s+OR\s+|[,;]", keyword, flags=re.IGNORECASE)
            if term.strip().strip('"')
        ]
        lowered = " ".join(terms).lower()
        if ".net" in lowered or "c#" in lowered or "asp.net" in lowered:
            terms.extend(
                [
                    "C#",
                    "ASP.NET",
                    "ASP.NET Core",
                    ".NET Core",
                    "Azure Developer",
                    "Senior Software Engineer .NET",
                    "Senior Backend Developer C#",
                    ".NET Solutions Architect",
                    "Lead .NET Developer",
                    "Principal .NET Developer",
                ]
            )
        if re.search(r"\bjava\b", lowered):
            terms.extend(
                [
                    "Spring Boot",
                    "Senior Software Engineer Java",
                    "Backend Java Developer",
                    "Java Full Stack Developer",
                    "Microservices Java",
                    "Java Cloud Developer",
                    "Lead Java Developer",
                    "Principal Java Developer",
                ]
            )
        unique: list[str] = []
        seen: set[str] = set()
        for term in terms:
            key = term.lower()
            if key not in seen:
                unique.append(term)
                seen.add(key)
        return unique

    @staticmethod
    def _expanded_location_terms(location: str) -> list[str]:
        terms = [
            term.strip()
            for term in re.split(r"[,;]", location)
            if term.strip()
        ]
        expanded: list[str] = []
        for term in terms:
            lower = term.lower()
            expanded.append(term)
            if lower == "dfw":
                expanded.extend(
                    [
                        "Dallas",
                        "Fort Worth",
                        "Plano",
                        "Frisco",
                        "Irving",
                        "Arlington",
                        "Richardson",
                        "Coppell",
                    ]
                )
            elif lower in {"tx", "texas"}:
                expanded.append("Texas")
            elif lower in {"nc", "north carolina"}:
                expanded.append("North Carolina")
        unique: list[str] = []
        seen: set[str] = set()
        for term in expanded:
            key = term.lower()
            if key not in seen:
                unique.append(term)
                seen.add(key)
        return unique

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
