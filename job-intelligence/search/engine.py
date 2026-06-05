from __future__ import annotations

from sqlalchemy.orm import Session

from storage.repository import JobRepository


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
        limit: int = 100,
        offset: int = 0,
    ):
        return self.repository.list_jobs(
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
            limit=limit,
            offset=offset,
        )
