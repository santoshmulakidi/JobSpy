from __future__ import annotations

import logging
from datetime import datetime

import requests

from collectors.base import CollectionRequest, CollectionResult, Collector, now_utc
from collectors.dedup import deduplicate_jobs

logger = logging.getLogger(__name__)


class AdzunaCollector(Collector):
    source_name = "adzuna"

    def __init__(self, *, app_id: str | None, app_key: str | None, country: str = "us", timeout_seconds: int = 20) -> None:
        self.app_id = app_id
        self.app_key = app_key
        self.country = country
        self.timeout_seconds = timeout_seconds

    def collect(self, request: CollectionRequest) -> CollectionResult:
        started_at = now_utc()
        jobs: list[dict] = []
        errors: list[str] = []
        if not self.app_id or not self.app_key:
            errors.append("adzuna requires JOB_INTELLIGENCE_ADZUNA_APP_ID and JOB_INTELLIGENCE_ADZUNA_APP_KEY in .env")
            return CollectionResult(request=request, run_started_at=started_at, run_finished_at=now_utc(), jobs=[], errors=errors)

        try:
            response = requests.get(
                f"https://api.adzuna.com/v1/api/jobs/{self.country}/search/1",
                params={
                    "app_id": self.app_id,
                    "app_key": self.app_key,
                    "what": request.search_term,
                    "where": request.location or "United States",
                    "results_per_page": min(request.results_wanted, 50),
                    "content-type": "application/json",
                },
                headers={"Accept": "application/json"},
                timeout=self.timeout_seconds,
            )
            if response.status_code in {401, 403}:
                errors.append("adzuna rejected the configured API credentials")
            elif response.status_code >= 400:
                errors.append(f"adzuna returned HTTP {response.status_code}")
            else:
                jobs = self._parse(response.json().get("results", []), request)
                if not jobs:
                    errors.append("adzuna returned no matching jobs")
        except requests.RequestException as exc:
            logger.exception("adzuna collection failed")
            errors.append(f"adzuna request failed: {exc}")
        except ValueError as exc:
            errors.append(f"adzuna returned invalid JSON: {exc}")

        return CollectionResult(
            request=request,
            run_started_at=started_at,
            run_finished_at=now_utc(),
            jobs=deduplicate_jobs(jobs)[: request.results_wanted],
            errors=errors,
        )

    def _parse(self, rows: list[dict], request: CollectionRequest) -> list[dict]:
        jobs: list[dict] = []
        for row in rows:
            title = row.get("title")
            url = row.get("redirect_url")
            if not title or not url:
                continue
            description = row.get("description") or ""
            location = (row.get("location") or {}).get("display_name") or request.location
            company = (row.get("company") or {}).get("display_name")
            jobs.append(
                {
                    "id": str(row.get("id") or url),
                    "site": self.source_name,
                    "job_url": url,
                    "job_url_direct": url,
                    "title": title,
                    "company": company,
                    "location": location,
                    "description": description,
                    "date_posted": self._parse_date(row.get("created")),
                    "job_type": row.get("contract_type"),
                    "is_remote": request.is_remote or "remote" in f"{title} {description} {location}".lower(),
                    "min_amount": row.get("salary_min"),
                    "max_amount": row.get("salary_max"),
                    "currency": "USD",
                    "raw": row,
                }
            )
        return jobs

    @staticmethod
    def _parse_date(value: str | None):
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            return None
