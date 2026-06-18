from __future__ import annotations

import logging
from datetime import datetime

import requests

from collectors.base import CollectionRequest, CollectionResult, Collector, now_utc
from collectors.dedup import deduplicate_jobs

logger = logging.getLogger(__name__)


class RemoteOKCollector(Collector):
    source_name = "remoteok"

    def __init__(self, *, timeout_seconds: int = 20) -> None:
        self.timeout_seconds = timeout_seconds

    def collect(self, request: CollectionRequest) -> CollectionResult:
        started_at = now_utc()
        jobs: list[dict] = []
        errors: list[str] = []
        try:
            response = requests.get(
                "https://remoteok.com/api",
                headers={"User-Agent": "Job Intelligence Platform", "Accept": "application/json"},
                timeout=self.timeout_seconds,
            )
            if response.status_code in {401, 403}:
                errors.append("remoteok blocked automated access")
            elif response.status_code >= 400:
                errors.append(f"remoteok returned HTTP {response.status_code}")
            else:
                jobs = self._parse(response.json(), request)
                if not jobs:
                    errors.append("remoteok returned no matching jobs")
        except requests.RequestException as exc:
            logger.exception("remoteok collection failed")
            errors.append(f"remoteok request failed: {exc}")
        except ValueError as exc:
            errors.append(f"remoteok returned invalid JSON: {exc}")

        return CollectionResult(
            request=request,
            run_started_at=started_at,
            run_finished_at=now_utc(),
            jobs=deduplicate_jobs(jobs)[: request.results_wanted],
            errors=errors,
        )

    def _parse(self, rows: list[dict], request: CollectionRequest) -> list[dict]:
        jobs: list[dict] = []
        terms = [term.lower() for term in request.search_term.split() if len(term) > 2 and term.upper() != "OR"]
        for row in rows:
            if not isinstance(row, dict) or row.get("legal"):
                continue
            title = row.get("position") or row.get("title")
            url = row.get("url")
            if not title or not url:
                continue
            tags = row.get("tags") or []
            description = " ".join(str(part) for part in [row.get("description"), " ".join(tags)] if part)
            haystack = f"{title} {description} {row.get('company')}".lower()
            if terms and not any(term in haystack for term in terms):
                continue
            jobs.append(
                {
                    "id": str(row.get("id") or url),
                    "site": self.source_name,
                    "job_url": url,
                    "job_url_direct": url,
                    "title": title,
                    "company": row.get("company"),
                    "location": row.get("location") or "Remote",
                    "description": description,
                    "date_posted": self._parse_date(row.get("date")),
                    "job_type": row.get("job_type"),
                    "is_remote": True,
                    "min_amount": row.get("salary_min"),
                    "max_amount": row.get("salary_max"),
                    "currency": "USD",
                    "raw": row,
                }
            )
            if len(jobs) >= request.results_wanted:
                break
        return jobs

    @staticmethod
    def _parse_date(value: str | None):
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            return None
