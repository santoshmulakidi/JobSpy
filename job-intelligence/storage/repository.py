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
    AIGenerationJob,
    AIGenerationStatus,
    Application,
    ChangeType,
    CoverLetterVersion,
    Company,
    DocumentKind,
    Job,
    JobChange,
    JobStatus,
    ResumeVersion,
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

    # Sources that should never appear in the senior-role active feed.
    _BLOCKED_SOURCES: frozenset[str] = frozenset({"simplify_new_grad", "github_internships"})

    # Career page URLs that always fail — block at storage so they never waste retries.
    _BLOCKED_CAREER_URLS: frozenset[str] = frozenset({"metacareers.com"})

    # jobright_h1b ignores search keywords — filter to only .NET/C# titles if it ever reappears
    _JOBRIGHT_TITLE_TOKENS = (".net", "c#", "dotnet", "csharp", "asp.net")

    # Jobs posted more than this many days ago are too stale to surface.
    _MAX_DATE_POSTED_DAYS = 7

    def upsert_jobs(self, jobs: Iterable[dict[str, Any]], search_run: SearchRun | None) -> list[Job]:
        upserted: list[Job] = []
        seen_fingerprints: set[str] = set()
        stale_cutoff = date.today() - timedelta(days=self._MAX_DATE_POSTED_DAYS)
        for raw_job in jobs:
            if raw_job.get("site") in self._BLOCKED_SOURCES or raw_job.get("source") in self._BLOCKED_SOURCES:
                continue
            # jobright_h1b floods DB with keyword-unrelated jobs — title-filter it
            if raw_job.get("site") == "jobright_h1b" or raw_job.get("source") == "jobright_h1b":
                title = (raw_job.get("title") or "").lower()
                if not any(t in title for t in self._JOBRIGHT_TITLE_TOKENS):
                    continue
            # Skip jobs the board posted more than 14 days ago — boards sometimes
            # return stale listings regardless of the hours_old filter we send them.
            raw_date = raw_job.get("date_posted")
            if raw_date is not None:
                coerced = self._coerce_date(raw_date)
                if coerced is not None and coerced < stale_cutoff:
                    continue
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

    def apply_job_lifecycle(self, *, active_hours: int = 168, retention_days: int = 30) -> dict[str, int]:
        """Keep the active feed fresh while preserving applied job history."""
        archived = self.archive_stale_jobs(active_hours=active_hours)
        deleted = self.delete_expired_jobs(retention_days=retention_days)
        return {"archived": archived, "deleted": deleted}

    def archive_stale_jobs(self, *, active_hours: int = 168) -> int:
        """Archive jobs not re-seen in active_hours OR posted more than 14 days ago."""
        cutoff = utc_now() - timedelta(hours=active_hours)
        date_cutoff = date.today() - timedelta(days=self._MAX_DATE_POSTED_DAYS)
        jobs = self.session.scalars(
            select(Job).where(
                and_(
                    Job.status == JobStatus.ACTIVE,
                    or_(
                        Job.last_seen_at < cutoff,
                        and_(Job.date_posted.isnot(None), Job.date_posted < date_cutoff),
                    ),
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
        first_seen_after: str | None = None,
        first_seen_before: str | None = None,
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
            first_seen_after=first_seen_after,
            first_seen_before=first_seen_before,
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

    def get_application(self, application_id: int) -> Application | None:
        return self.session.get(Application, application_id)

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

    def enqueue_ai_generation_jobs(
        self,
        *,
        job_ids: Iterable[int],
        generation_type: DocumentKind | str,
        base_resume: str,
        profile_name: str | None = None,
        provider: str | None = None,
        model: str | None = None,
        force_regenerate: bool = False,
    ) -> list[AIGenerationJob]:
        document_kind = DocumentKind(generation_type)
        queued: list[AIGenerationJob] = []
        for job_id in job_ids:
            job = self.get_job(job_id)
            if job is None:
                continue
            generation_job = AIGenerationJob(
                job_id=job.id,
                profile_name=profile_name,
                generation_type=document_kind,
                status=AIGenerationStatus.QUEUED,
                company_name=job.company_name,
                job_title=job.title,
                provider=provider,
                model=model,
                base_resume=base_resume,
                force_regenerate=force_regenerate,
            )
            self.session.add(generation_job)
            queued.append(generation_job)
        self.session.flush()
        return queued

    def list_ai_generation_jobs(self, *, limit: int = 100) -> list[AIGenerationJob]:
        return list(
            self.session.scalars(
                select(AIGenerationJob)
                .order_by(AIGenerationJob.created_at.desc(), AIGenerationJob.id.desc())
                .limit(limit)
            )
        )

    def next_queued_ai_generation_job(self) -> AIGenerationJob | None:
        return self.session.scalar(
            select(AIGenerationJob)
            .where(AIGenerationJob.status == AIGenerationStatus.QUEUED)
            .order_by(AIGenerationJob.created_at.asc(), AIGenerationJob.id.asc())
            .limit(1)
        )

    def mark_ai_generation_running(self, generation_job: AIGenerationJob) -> None:
        generation_job.status = AIGenerationStatus.RUNNING
        generation_job.started_at = utc_now()
        generation_job.updated_at = utc_now()
        self.session.flush()

    def mark_ai_generation_completed(
        self,
        generation_job: AIGenerationJob,
        *,
        resume_version: ResumeVersion | None = None,
        cover_letter_version: CoverLetterVersion | None = None,
    ) -> None:
        generation_job.status = AIGenerationStatus.COMPLETED
        generation_job.resume_version_id = resume_version.id if resume_version else generation_job.resume_version_id
        generation_job.cover_letter_version_id = (
            cover_letter_version.id if cover_letter_version else generation_job.cover_letter_version_id
        )
        generation_job.finished_at = utc_now()
        generation_job.updated_at = utc_now()
        generation_job.error = None
        self.session.flush()

    def mark_ai_generation_failed(
        self,
        generation_job: AIGenerationJob,
        *,
        status: AIGenerationStatus = AIGenerationStatus.FAILED,
        error: str,
    ) -> None:
        generation_job.status = status
        generation_job.error = error
        generation_job.finished_at = utc_now()
        generation_job.updated_at = utc_now()
        self.session.flush()

    def save_resume_version(
        self,
        *,
        job: Job,
        profile_name: str | None,
        provider: str | None,
        model: str | None,
        content_text: str,
        job_description_snapshot: str | None,
        ats_before_score: int | None,
        ats_after_score: int | None,
        warnings: list[str],
        prompt: str | None,
    ) -> ResumeVersion:
        version = ResumeVersion(
            job_id=job.id,
            profile_name=profile_name,
            company_name=job.company_name,
            job_title=job.title,
            provider=provider,
            model=model,
            content_text=content_text,
            job_description_snapshot=job_description_snapshot,
            ats_before_score=ats_before_score,
            ats_after_score=ats_after_score,
            warnings=warnings,
            prompt=prompt,
        )
        self.session.add(version)
        self.session.flush()
        return version

    def save_cover_letter_version(
        self,
        *,
        job: Job,
        profile_name: str | None,
        provider: str | None,
        model: str | None,
        content_text: str,
        job_description_snapshot: str | None,
        warnings: list[str],
        prompt: str | None,
    ) -> CoverLetterVersion:
        version = CoverLetterVersion(
            job_id=job.id,
            profile_name=profile_name,
            company_name=job.company_name,
            job_title=job.title,
            provider=provider,
            model=model,
            content_text=content_text,
            job_description_snapshot=job_description_snapshot,
            warnings=warnings,
            prompt=prompt,
        )
        self.session.add(version)
        self.session.flush()
        return version

    def find_latest_resume_version(
        self,
        *,
        job_id: int,
        profile_name: str | None,
        provider: str | None,
        model: str | None,
    ) -> ResumeVersion | None:
        return self.session.scalar(
            select(ResumeVersion)
            .where(
                ResumeVersion.job_id == job_id,
                ResumeVersion.profile_name == profile_name,
                ResumeVersion.provider == provider,
                ResumeVersion.model == model,
            )
            .order_by(ResumeVersion.created_at.desc(), ResumeVersion.id.desc())
            .limit(1)
        )

    def find_latest_cover_letter_version(
        self,
        *,
        job_id: int,
        profile_name: str | None,
        provider: str | None,
        model: str | None,
    ) -> CoverLetterVersion | None:
        return self.session.scalar(
            select(CoverLetterVersion)
            .where(
                CoverLetterVersion.job_id == job_id,
                CoverLetterVersion.profile_name == profile_name,
                CoverLetterVersion.provider == provider,
                CoverLetterVersion.model == model,
            )
            .order_by(CoverLetterVersion.created_at.desc(), CoverLetterVersion.id.desc())
            .limit(1)
        )

    def get_job_documents(self, job_id: int) -> dict[str, list[ResumeVersion] | list[CoverLetterVersion]]:
        resume_versions = list(
            self.session.scalars(
                select(ResumeVersion)
                .where(ResumeVersion.job_id == job_id)
                .order_by(ResumeVersion.created_at.desc(), ResumeVersion.id.desc())
            )
        )
        cover_letter_versions = list(
            self.session.scalars(
                select(CoverLetterVersion)
                .where(CoverLetterVersion.job_id == job_id)
                .order_by(CoverLetterVersion.created_at.desc(), CoverLetterVersion.id.desc())
            )
        )
        return {
            "resume_versions": resume_versions,
            "cover_letter_versions": cover_letter_versions,
        }

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

    # Aggregator placeholder names that aren't real companies
    _AGGREGATOR_COMPANY_PATTERNS = (
        "jobs via ",
        "posted via ",
        "via ",
    )

    def company_counts(self, limit: int = 20) -> list[tuple[str, int]]:
        stmt = (
            select(Job.company_name, func.count(Job.id))
            .where(and_(Job.status == JobStatus.ACTIVE, Job.company_name.is_not(None)))
            .group_by(Job.company_name)
            .order_by(func.count(Job.id).desc())
            .limit(limit * 3)  # fetch extra to account for filtered aggregators
        )
        rows = list(self.session.execute(stmt))
        results = []
        for name, count in rows:
            lower = (name or "").lower()
            if any(lower.startswith(p) for p in self._AGGREGATOR_COMPANY_PATTERNS):
                continue
            results.append((name, count))
            if len(results) >= limit:
                break
        return results

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
        first_seen_after: str | None = None,
        first_seen_before: str | None = None,
    ) -> Select:
        statement = select(Job).where(Job.status == JobStatus.ACTIVE)
        if first_seen_after:
            statement = statement.where(Job.first_seen_at >= first_seen_after)
        if first_seen_before:
            statement = statement.where(Job.first_seen_at < first_seen_before)
        if keyword:
            # Title-only match — description matching is too broad and pulls in
            # QA/Salesforce/unrelated jobs that mention .NET/C# as a footnote.
            # The DB is already .NET-focused (collected by keyword), so title is enough.
            keyword_conditions = [
                Job.title.ilike(f"%{term}%")
                for term in self._expanded_keyword_terms(keyword)
            ]
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
        if ".net" in lowered or "c#" in lowered or "asp.net" in lowered or "dotnet" in lowered:
            # Only add title-specific patterns — bare "C#" or "ASP.NET" match too many unrelated titles
            terms.extend(
                [
                    ".NET Developer",
                    "C# Developer",
                    "ASP.NET Developer",
                    ".NET Engineer",
                    "C# Engineer",
                    ".NET Architect",
                    "DotNet Developer",
                    "Full Stack .NET",
                    "Backend Developer C#",
                    "Software Engineer .NET",
                    "Software Engineer C#",
                ]
            )
        if re.search(r"\bjava\b", lowered):
            terms.extend(
                [
                    "Java Developer",
                    "Java Engineer",
                    "Spring Boot Developer",
                    "Java Full Stack",
                    "Backend Java Developer",
                    "Java Software Engineer",
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

    @staticmethod
    def _clean_company_name(name: str | None) -> str | None:
        if not name:
            return name
        import re as _re
        # Strip aggregator prefixes like "Jobs via Dice", "Posted via LinkedIn"
        cleaned = _re.sub(r"^(?:jobs?\s+via|posted\s+(?:via|on|by)|via)\s+", "", name.strip(), flags=_re.IGNORECASE)
        # Strip trailing aggregator suffixes like "- via Dice"
        cleaned = _re.sub(r"\s*[-–]\s*(?:via|on)\s+\w+$", "", cleaned, flags=_re.IGNORECASE)
        return cleaned.strip() or name

    def _normalize_job(self, raw_job: dict[str, Any]) -> dict[str, Any]:
        company_name = self._clean_company_name(raw_job.get("company") or raw_job.get("company_name"))
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
