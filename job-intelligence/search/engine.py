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
            remote=remote,
            min_salary=min_salary,
            max_salary=max_salary,
            limit=limit,
            offset=offset,
        )
