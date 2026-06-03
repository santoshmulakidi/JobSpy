from __future__ import annotations

from collectors.base import CollectionRequest, CollectionResult, Collector, now_utc


class CompanyCareerPageCollector(Collector):
    """Placeholder for direct ATS/company-page collectors.

    The first production targets should be Greenhouse, Lever, Workday, Ashby, and
    company-specific RSS/API feeds. Keeping this as a separate collector prevents
    custom career-page logic from leaking into the JobSpy adapter.
    """

    def collect(self, request: CollectionRequest) -> CollectionResult:
        return CollectionResult(
            request=request,
            run_started_at=now_utc(),
            run_finished_at=now_utc(),
            jobs=[],
            errors=["company career page collection is not implemented yet"],
        )
