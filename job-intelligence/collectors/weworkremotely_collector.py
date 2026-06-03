from __future__ import annotations

import logging
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup

from collectors.base import CollectionRequest, CollectionResult, Collector, now_utc
from collectors.dedup import deduplicate_jobs

logger = logging.getLogger(__name__)


class WeWorkRemotelyCollector(Collector):
    source_name = "weworkremotely"
    base_url = "https://weworkremotely.com"

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
            if response.status_code == 403 or "Just a moment" in response.text[:1000]:
                errors.append(
                    "weworkremotely blocked automated access with a Cloudflare challenge; "
                    "this source needs a browser-assisted or partner/API connector"
                )
            elif response.status_code >= 400:
                errors.append(f"weworkremotely returned HTTP {response.status_code}")
            else:
                jobs = self._parse_jobs(response.text, request, response.url)
                if not jobs:
                    errors.append("weworkremotely returned no parseable jobs")
        except requests.RequestException as exc:
            logger.exception("weworkremotely collection failed")
            errors.append(f"weworkremotely request failed: {exc}")

        return CollectionResult(
            request=request,
            run_started_at=started_at,
            run_finished_at=now_utc(),
            jobs=deduplicate_jobs(jobs)[: request.results_wanted],
            errors=errors,
        )

    def _search_url(self, request: CollectionRequest) -> str:
        return f"{self.base_url}/remote-jobs/search?term={quote_plus(request.search_term)}"

    def _parse_jobs(
        self,
        html: str,
        request: CollectionRequest,
        source_url: str,
    ) -> list[dict]:
        soup = BeautifulSoup(html, "html.parser")
        jobs: list[dict] = []

        for link in soup.select("a[href*='/remote-jobs/']"):
            href = link.get("href")
            title = " ".join(link.get_text(" ", strip=True).split())
            if not href or not title or "/remote-jobs/search" in href:
                continue
            if href.startswith("/"):
                href = f"{self.base_url}{href}"
            card = link.find_parent("li") or link.find_parent("article")
            card_text = " ".join(card.get_text(" ", strip=True).split()) if card else title
            jobs.append(
                {
                    "id": f"weworkremotely-{href.rsplit('/', 1)[-1]}",
                    "site": self.source_name,
                    "job_url": href,
                    "job_url_direct": href,
                    "title": title,
                    "company": None,
                    "location": request.location or "Remote",
                    "description": card_text,
                    "is_remote": True,
                    "raw": {"source_url": source_url, "card_text": card_text},
                }
            )
            if len(jobs) >= request.results_wanted:
                break

        return jobs
