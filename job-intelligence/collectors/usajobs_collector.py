from __future__ import annotations

import logging

import requests

from collectors.base import CollectionRequest, CollectionResult, Collector, now_utc
from collectors.dedup import deduplicate_jobs

logger = logging.getLogger(__name__)


class USAJobsCollector(Collector):
    source_name = "usajobs_api"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        user_agent: str | None = None,
        timeout_seconds: int = 20,
    ) -> None:
        self.api_key = api_key
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds

    def collect(self, request: CollectionRequest) -> CollectionResult:
        started_at = now_utc()
        errors: list[str] = []
        jobs: list[dict] = []

        if not self.api_key or not self.user_agent:
            errors.append(
                "usajobs_api requires JOB_INTELLIGENCE_USAJOBS_API_KEY and "
                "JOB_INTELLIGENCE_USAJOBS_USER_AGENT in .env"
            )
            return CollectionResult(
                request=request,
                run_started_at=started_at,
                run_finished_at=now_utc(),
                jobs=[],
                errors=errors,
            )

        try:
            response = requests.get(
                "https://data.usajobs.gov/api/search",
                params={
                    "Keyword": request.search_term,
                    "LocationName": request.location or "United States",
                    "ResultsPerPage": min(request.results_wanted, 500),
                    "Page": 1,
                },
                headers={
                    "Host": "data.usajobs.gov",
                    "User-Agent": self.user_agent,
                    "Authorization-Key": self.api_key,
                },
                timeout=self.timeout_seconds,
            )
            if response.status_code in {401, 403}:
                errors.append("usajobs_api rejected the configured API credentials")
            elif response.status_code >= 400:
                errors.append(f"usajobs_api returned HTTP {response.status_code}")
            else:
                jobs = self._parse_jobs(response.json(), request)
                if not jobs:
                    errors.append("usajobs_api returned no matching jobs")
        except requests.RequestException as exc:
            logger.exception("usajobs_api collection failed")
            errors.append(f"usajobs_api request failed: {exc}")
        except ValueError as exc:
            errors.append(f"usajobs_api returned invalid JSON: {exc}")

        return CollectionResult(
            request=request,
            run_started_at=started_at,
            run_finished_at=now_utc(),
            jobs=deduplicate_jobs(jobs)[: request.results_wanted],
            errors=errors,
        )

    def _parse_jobs(self, payload: dict, request: CollectionRequest) -> list[dict]:
        items = payload.get("SearchResult", {}).get("SearchResultItems", [])
        jobs: list[dict] = []
        for item in items:
            descriptor = item.get("MatchedObjectDescriptor", {})
            position_id = descriptor.get("PositionID")
            title = descriptor.get("PositionTitle") or "Untitled federal role"
            organization = descriptor.get("OrganizationName")
            locations = descriptor.get("PositionLocation") or []
            location = ", ".join(
                entry.get("LocationName", "") for entry in locations if entry.get("LocationName")
            )
            description = descriptor.get("UserArea", {}).get("Details", {}).get("JobSummary")
            apply_uri = (descriptor.get("ApplyURI") or [None])[0]
            job_url = descriptor.get("PositionURI") or apply_uri
            jobs.append(
                {
                    "id": position_id or f"usajobs-{abs(hash(job_url or title))}",
                    "site": self.source_name,
                    "job_url": job_url,
                    "job_url_direct": apply_uri or job_url,
                    "title": title[:500],
                    "company": organization,
                    "location": location or request.location,
                    "description": description,
                    "job_type": descriptor.get("PositionSchedule", [{}])[0].get("Name"),
                    "is_remote": request.is_remote or self._is_remote(descriptor, location, description),
                    "date_posted": descriptor.get("PublicationStartDate"),
                    "raw": descriptor,
                }
            )
        return jobs

    @staticmethod
    def _is_remote(descriptor: dict, location: str | None, description: str | None) -> bool:
        text = f"{location or ''} {description or ''} {descriptor.get('PositionOfferingType', '')}".lower()
        return "remote" in text or "anywhere in the u.s." in text
