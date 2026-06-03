from __future__ import annotations

import logging
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup

from collectors.base import CollectionRequest, CollectionResult, Collector, now_utc
from collectors.dedup import deduplicate_jobs

logger = logging.getLogger(__name__)


class RemotelyJobsCollector(Collector):
    source_name = "remotely"
    base_url = "https://www.remotely.jobs"

    def __init__(self, timeout_seconds: int = 20) -> None:
        self.timeout_seconds = timeout_seconds

    def collect(self, request: CollectionRequest) -> CollectionResult:
        started_at = now_utc()
        errors: list[str] = []
        jobs: list[dict] = []

        try:
            response = requests.get(
                self._search_url(request),
                timeout=self.timeout_seconds,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            if response.status_code >= 400:
                errors.append(f"remotely.jobs returned HTTP {response.status_code}")
            else:
                jobs = self._parse_jobs(response.text, request, response.url)
                if not jobs:
                    errors.append("remotely.jobs returned no parseable jobs")
        except requests.RequestException as exc:
            logger.exception("remotely.jobs collection failed")
            errors.append(f"remotely.jobs request failed: {exc}")

        return CollectionResult(
            request=request,
            run_started_at=started_at,
            run_finished_at=now_utc(),
            jobs=deduplicate_jobs(jobs)[: request.results_wanted],
            errors=errors,
        )

    def _search_url(self, request: CollectionRequest) -> str:
        return f"{self.base_url}/search?query={quote_plus(request.search_term)}"

    def _parse_jobs(
        self,
        html: str,
        request: CollectionRequest,
        source_url: str,
    ) -> list[dict]:
        soup = BeautifulSoup(html, "html.parser")
        jobs: list[dict] = []

        for article in soup.select("article.job-card-horizontal"):
            link = article.select_one("a[href*='/show/']")
            title = self._text(article, ".job-title") or (link.get_text(" ", strip=True) if link else None)
            href = link.get("href") if link else None
            if not title or not href:
                continue
            if href.startswith("/"):
                href = f"{self.base_url}{href}"

            company = self._text(article, ".company-name")
            meta = self._text(article, ".job-meta")
            description = self._text(article, ".job-description")
            location = self._location_from_meta(meta) or request.location or "Remote"

            jobs.append(
                {
                    "id": f"remotely-{href.rsplit('/', 1)[-1]}",
                    "site": self.source_name,
                    "job_url": href,
                    "job_url_direct": href,
                    "title": title,
                    "company": company,
                    "location": location,
                    "description": description,
                    "is_remote": True,
                    "raw": {
                        "source_url": source_url,
                        "meta": meta,
                    },
                }
            )

            if len(jobs) >= request.results_wanted:
                break

        return jobs

    @staticmethod
    def _text(article, selector: str) -> str | None:
        element = article.select_one(selector)
        if not element:
            return None
        text = " ".join(element.get_text(" ", strip=True).replace("\xa0", " ").split())
        return text or None

    @staticmethod
    def _location_from_meta(meta: str | None) -> str | None:
        if not meta:
            return None
        marker = " days ago"
        if marker in meta:
            return meta.split(marker, 1)[0].rsplit(" ", 1)[0].strip() or None
        return meta
