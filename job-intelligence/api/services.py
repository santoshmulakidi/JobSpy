from __future__ import annotations

from sqlalchemy.orm import Session

from collectors import (
    AtsCareerPageCollector,
    CareerBuilderCollector,
    CollectionRequest,
    CollectionResult,
    GovernmentJobsCollector,
    JobSpyCollector,
    MarkdownJobCollector,
    RemotelyJobsCollector,
    SimpleWebJobCollector,
    USAJobsCollector,
    WeWorkRemotelyCollector,
)
from collectors.base import now_utc
from collectors.company_targets import select_company_targets
from collectors.query_templates import build_source_query
from storage.config import get_settings
from storage.repository import JobRepository


class CollectionService:
    jobspy_sites = {"linkedin", "indeed", "zip_recruiter", "glassdoor", "google"}
    careerbuilder_sites = {"careerbuilder"}
    governmentjobs_sites = {"governmentjobs"}
    usajobs_sites = {"usajobs_api"}
    remotely_sites = {"remotely"}
    weworkremotely_sites = {"weworkremotely"}
    career_page_sites = {"career_page"}
    h1b_markdown_sites = {"jobright_h1b", "simplify_new_grad", "github_internships"}
    simple_web_sites = {
        "college_recruiter",
        "careerhound",
        "dice",
        "dynamitejobs",
        "glever",
        "hiringcafe",
        "jobspresso",
        "jobsgrep",
        "jobsh1b",
        "remotive",
        "skipthedrive",
        "visafriendly",
        "wellfound",
        "yc_jobs",
    }

    def __init__(self, session: Session, collector: JobSpyCollector | None = None) -> None:
        self.session = session
        self.collector = collector or JobSpyCollector()
        self.careerbuilder_collector = CareerBuilderCollector()
        self.governmentjobs_collector = GovernmentJobsCollector()
        settings = get_settings()
        self.usajobs_collector = USAJobsCollector(
            api_key=settings.usajobs_api_key,
            user_agent=settings.usajobs_user_agent,
        )
        self.remotely_collector = RemotelyJobsCollector()
        self.weworkremotely_collector = WeWorkRemotelyCollector()
        self.career_page_collector = AtsCareerPageCollector()
        self.h1b_markdown_collectors = {
            "jobright_h1b": MarkdownJobCollector(
                source_name="jobright_h1b",
                source_url="https://raw.githubusercontent.com/jobright-ai/Daily-H1B-Jobs-In-Tech/master/README.md",
                fallback_urls=[
                    "https://raw.githubusercontent.com/jobright-ai/Daily-H1B-Jobs-In-Tech/main/README.md",
                ],
                visa_friendly=True,
            ),
            "simplify_new_grad": MarkdownJobCollector(
                source_name="simplify_new_grad",
                source_url="https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md",
            ),
            "github_internships": MarkdownJobCollector(
                source_name="github_internships",
                source_url="https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md",
            ),
        }
        self.simple_web_collectors = {
            "dice": SimpleWebJobCollector(
                source_name="dice",
                search_url_template="https://www.dice.com/jobs?q={query}&location={location}",
            ),
            "wellfound": SimpleWebJobCollector(
                source_name="wellfound",
                search_url_template="https://wellfound.com/jobs?keyword={query}",
            ),
            "yc_jobs": SimpleWebJobCollector(
                source_name="yc_jobs",
                search_url_template="https://www.ycombinator.com/jobs?query={query}",
            ),
            "college_recruiter": SimpleWebJobCollector(
                source_name="college_recruiter",
                search_url_template="https://www.collegerecruiter.com/job-search?keyword={query}&location={location}",
            ),
            "careerhound": SimpleWebJobCollector(
                source_name="careerhound",
                search_url_template="https://www.careerhound.io/?query={query}&location={location}",
            ),
            "jobspresso": SimpleWebJobCollector(
                source_name="jobspresso",
                search_url_template="https://jobspresso.co/remote-work/?search_keywords={query}",
            ),
            "dynamitejobs": SimpleWebJobCollector(
                source_name="dynamitejobs",
                search_url_template="https://dynamitejobs.com/remote-jobs/?search={query}",
            ),
            "skipthedrive": SimpleWebJobCollector(
                source_name="skipthedrive",
                search_url_template="https://www.skipthedrive.com/?s={query}",
            ),
            "remotive": SimpleWebJobCollector(
                source_name="remotive",
                search_url_template="https://remotive.com/remote-jobs?search={query}",
            ),
            "jobsh1b": SimpleWebJobCollector(
                source_name="jobsh1b",
                search_url_template="https://jobsh1b.com/jobs?search={query}&location={location}",
            ),
            "visafriendly": SimpleWebJobCollector(
                source_name="visafriendly",
                search_url_template="https://www.visafriendly.com/jobs?search={query}&location={location}",
            ),
            "glever": SimpleWebJobCollector(
                source_name="glever",
                search_url_template="https://glever.co/search?q={query}&location={location}",
            ),
            "jobsgrep": SimpleWebJobCollector(
                source_name="jobsgrep",
                search_url_template="https://jobsgrep.com/jobs?query={query}&location={location}",
            ),
            "hiringcafe": SimpleWebJobCollector(
                source_name="hiringcafe",
                search_url_template="https://hiring.cafe/?search={query}&location={location}",
            ),
        }
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
        governmentjobs_sites = [site for site in request.sites if site in self.governmentjobs_sites]
        usajobs_sites = [site for site in request.sites if site in self.usajobs_sites]
        remotely_sites = [site for site in request.sites if site in self.remotely_sites]
        weworkremotely_sites = [site for site in request.sites if site in self.weworkremotely_sites]
        career_page_sites = [site for site in request.sites if site in self.career_page_sites]
        h1b_markdown_sites = [site for site in request.sites if site in self.h1b_markdown_sites]
        simple_web_sites = [site for site in request.sites if site in self.simple_web_sites]
        supported_sites = (
            self.jobspy_sites
            | self.careerbuilder_sites
            | self.governmentjobs_sites
            | self.usajobs_sites
            | self.remotely_sites
            | self.weworkremotely_sites
            | self.career_page_sites
            | self.h1b_markdown_sites
            | self.simple_web_sites
        )
        unsupported_sites = sorted(set(request.sites) - supported_sites)

        if jobspy_sites:
            result = self.collector.collect(request.model_copy(update={"sites": jobspy_sites}))
            jobs.extend(result.jobs)
            errors.extend(result.errors)

            if request.use_company_targets:
                targets = select_company_targets(request.company_target_limit)
                if request.visa_friendly_only:
                    targets = [target for target in targets if self._is_visa_friendly_target(target)]
                results_per_company = max(1, min(10, request.results_wanted // max(len(targets), 1)))
                for target in targets:
                    company = target["company"]
                    for site in jobspy_sites:
                        company_request = request.model_copy(
                            update={
                                "sites": [site],
                                "search_term": build_source_query(
                                    site,
                                    request.search_term,
                                    company,
                                    request.visa_friendly_only,
                                ),
                                "results_wanted": results_per_company,
                                "metadata": {
                                    **request.metadata,
                                    "query_template_source": site,
                                    "company_target": company,
                                    "company_target_rank": target["rank"],
                                    "company_target_career_url": target.get("career_url"),
                                },
                            }
                        )
                        company_result = self.collector.collect(company_request)
                        for job in company_result.jobs:
                            job.setdefault("company_target", company)
                            job.setdefault("company_target_rank", target["rank"])
                            job.setdefault("company_target_career_url", target.get("career_url"))
                        jobs.extend(company_result.jobs)
                        errors.extend(company_result.errors)

        if careerbuilder_sites:
            result = self.careerbuilder_collector.collect(
                request.model_copy(update={"sites": careerbuilder_sites})
            )
            jobs.extend(result.jobs)
            errors.extend(result.errors)

        if governmentjobs_sites:
            result = self.governmentjobs_collector.collect(
                request.model_copy(update={"sites": governmentjobs_sites})
            )
            jobs.extend(result.jobs)
            errors.extend(result.errors)

        if usajobs_sites:
            result = self.usajobs_collector.collect(request.model_copy(update={"sites": usajobs_sites}))
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

        if career_page_sites:
            result = self.career_page_collector.collect(
                request.model_copy(update={"sites": career_page_sites, "use_company_targets": True})
            )
            jobs.extend(result.jobs)
            errors.extend(result.errors)

        for site in h1b_markdown_sites:
            result = self.h1b_markdown_collectors[site].collect(request.model_copy(update={"sites": [site]}))
            jobs.extend(result.jobs)
            errors.extend(result.errors)

        for site in simple_web_sites:
            result = self.simple_web_collectors[site].collect(request.model_copy(update={"sites": [site]}))
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

    @staticmethod
    def _is_visa_friendly_target(target: dict) -> bool:
        status = str(target.get("sponsor_status") or "").lower()
        h1b = str(target.get("h1b_or_funding") or "").lower()
        return any(token in status for token in ("strong", "active")) or any(char.isdigit() for char in h1b)
