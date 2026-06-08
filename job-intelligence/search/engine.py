from __future__ import annotations

from sqlalchemy.orm import Session

from storage.repository import JobRepository
from search.scoring import score_job


class SearchEngine:
    def __init__(self, session: Session) -> None:
        self.repository = JobRepository(session)

    def search(
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
        qualification_status: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ):
        jobs = self.repository.list_jobs(
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
            limit=500 if qualification_status else limit,
            offset=0 if qualification_status else offset,
        )
        if qualification_status:
            profile = self.repository.get_profile()
            normalized = qualification_status.lower()
            jobs = [
                job for job in jobs
                if score_job(job, profile).qualification_status.lower() == normalized
            ]
            jobs = sorted(jobs, key=lambda job: score_job(job, profile).fit_score, reverse=True)
            return jobs[offset : offset + limit]
        return jobs
