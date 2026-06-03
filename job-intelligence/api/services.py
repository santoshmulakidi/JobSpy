from __future__ import annotations

from sqlalchemy.orm import Session

from collectors import (
    CareerBuilderCollector,
    CollectionRequest,
    CollectionResult,
    JobSpyCollector,
    RemotelyJobsCollector,
    WeWorkRemotelyCollector,
)
from collectors.base import now_utc
from storage.repository import JobRepository


class CollectionService:
    jobspy_sites = {"linkedin", "indeed", "zip_recruiter", "glassdoor", "google"}
    careerbuilder_sites = {"careerbuilder"}
    remotely_sites = {"remotely"}
    weworkremotely_sites = {"weworkremotely"}

    def __init__(self, session: Session, collector: JobSpyCollector | None = None) -> None:
        self.session = session
        self.collector = collector or JobSpyCollector()
        self.careerbuilder_collector = CareerBuilderCollector()
        self.remotely_collector = RemotelyJobsCollector()
        self.weworkremotely_collector = WeWorkRemotelyCollector()
        self.repository = JobRepository(session)

    def collect(self, request: CollectionRequest):
        result = self._collect_all_sources(request)
        run = self.repository.create_search_run(
            search_term=request.search_term,
            location=request.location,
            sites=request.sites,
            results_wanted=request.results_wanted,
            started_at=result.run_started_at,
            metadata=request.metadata,
        )
        self.repository.upsert_jobs(result.jobs, run)
        self.repository.complete_search_run(
            run,
            finished_at=result.run_finished_at,
            jobs_seen=result.count,
            errors=result.errors,
        )
        self.session.commit()
        return run, result

    def _collect_all_sources(self, request: CollectionRequest) -> CollectionResult:
        started_at = now_utc()
        jobs: list[dict] = []
        errors: list[str] = []

        jobspy_sites = [site for site in request.sites if site in self.jobspy_sites]
        careerbuilder_sites = [site for site in request.sites if site in self.careerbuilder_sites]
        remotely_sites = [site for site in request.sites if site in self.remotely_sites]
        weworkremotely_sites = [site for site in request.sites if site in self.weworkremotely_sites]
        supported_sites = (
            self.jobspy_sites
            | self.careerbuilder_sites
            | self.remotely_sites
            | self.weworkremotely_sites
        )
        unsupported_sites = sorted(set(request.sites) - supported_sites)

        if jobspy_sites:
            result = self.collector.collect(request.model_copy(update={"sites": jobspy_sites}))
            jobs.extend(result.jobs)
            errors.extend(result.errors)

        if careerbuilder_sites:
            result = self.careerbuilder_collector.collect(
                request.model_copy(update={"sites": careerbuilder_sites})
            )
            jobs.extend(result.jobs)
            errors.extend(result.errors)

        if remotely_sites:
            result = self.remotely_collector.collect(request.model_copy(update={"sites": remotely_sites}))
            jobs.extend(result.jobs)
            errors.extend(result.errors)

        if weworkremotely_sites:
            result = self.weworkremotely_collector.collect(
                request.model_copy(update={"sites": weworkremotely_sites})
            )
            jobs.extend(result.jobs)
            errors.extend(result.errors)

        for site in unsupported_sites:
            errors.append(f"unsupported source: {site}")

        return CollectionResult(
            request=request,
            run_started_at=started_at,
            run_finished_at=now_utc(),
            jobs=jobs,
            errors=errors,
        )
