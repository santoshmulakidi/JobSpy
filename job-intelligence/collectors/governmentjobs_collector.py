from __future__ import annotations

import logging
from urllib.parse import quote_plus, urlparse

import requests
from bs4 import BeautifulSoup

from collectors.base import CollectionRequest, CollectionResult, Collector, now_utc
from collectors.dedup import deduplicate_jobs

logger = logging.getLogger(__name__)


class GovernmentJobsCollector(Collector):
    source_name = "governmentjobs"

    def __init__(self, *, timeout_seconds: int = 20, max_pages: int = 5) -> None:
        self.timeout_seconds = timeout_seconds
        self.max_pages = max_pages

    def collect(self, request: CollectionRequest) -> CollectionResult:
        started_at = now_utc()
        jobs: list[dict] = []
        errors: list[str] = []

        for page in range(1, self.max_pages + 1):
            if len(jobs) >= request.results_wanted:
                break
            url = self._search_url(request, page)
            try:
                response = requests.get(
                    url,
                    headers={
                        "User-Agent": (
                            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
                        ),
                        "Accept": "text/html,application/xhtml+xml",
                    },
                    timeout=self.timeout_seconds,
                )
                if response.status_code in {401, 403}:
                    errors.append("governmentjobs blocked automated access")
                    break
                if response.status_code >= 400:
                    errors.append(f"governmentjobs returned HTTP {response.status_code}")
                    break
                page_jobs = self._parse_jobs(response.text, request, response.url)
                if not page_jobs:
                    if page == 1:
                        errors.append("governmentjobs returned no matching jobs")
                    break
                jobs.extend(page_jobs)
            except requests.RequestException as exc:
                logger.exception("governmentjobs collection failed")
                errors.append(f"governmentjobs request failed: {exc}")
                break

        return CollectionResult(
            request=request,
            run_started_at=started_at,
            run_finished_at=now_utc(),
            jobs=deduplicate_jobs(jobs)[: request.results_wanted],
            errors=errors,
        )

    def _search_url(self, request: CollectionRequest, page: int) -> str:
        params = [
            f"keyword={quote_plus(request.search_term)}",
            "isTransfer=False",
            "isPromotional=False",
        ]
        if request.location:
            params.append(f"location={quote_plus(request.location)}")
        if page > 1:
            params.insert(0, f"page={page}")
        return f"https://www.governmentjobs.com/jobs?{'&'.join(params)}"

    def _parse_jobs(self, html: str, request: CollectionRequest, source_url: str) -> list[dict]:
        soup = BeautifulSoup(html, "html.parser")
        jobs: list[dict] = []
        for item in soup.select("li.job-item"):
            link = item.select_one("a.job-details-link[href]")
            if link is None:
                continue
            href = link.get("href")
            title = " ".join(link.get_text(" ", strip=True).split())
            if not href or not title:
                continue
            organization = self._text(item, ".job-organization")
            location = self._text(item, ".job-location") or request.location
            card_text = " ".join(item.get_text(" ", strip=True).split())
            if not self._matches(title, card_text, request):
                continue
            job_url = self._absolute_url(source_url, href)
            source_job_id = item.get("data-job-id") or f"governmentjobs-{abs(hash(job_url))}"
            jobs.append(
                {
                    "id": source_job_id,
                    "site": self.source_name,
                    "job_url": job_url,
                    "job_url_direct": job_url,
                    "title": title[:500],
                    "company": organization,
                    "location": location,
                    "description": card_text,
                    "is_remote": request.is_remote or "remote" in card_text.lower(),
                    "raw": {"source_url": source_url, "card_text": card_text},
                }
            )
        return jobs

    @staticmethod
    def _matches(title: str, card_text: str, request: CollectionRequest) -> bool:
        text = f"{title} {card_text}".lower()
        terms = [term.lower() for term in request.search_term.split() if len(term) > 2]
        return not terms or any(term in text for term in terms)

    @staticmethod
    def _text(item, selector: str) -> str | None:
        node = item.select_one(selector)
        if node is None:
            return None
        value = " ".join(node.get_text(" ", strip=True).split())
        return value or None

    @staticmethod
    def _absolute_url(source_url: str, href: str) -> str:
        if href.startswith("http"):
            return href
        parsed = urlparse(source_url)
        if href.startswith("/"):
            return f"{parsed.scheme}://{parsed.netloc}{href}"
        return f"{parsed.scheme}://{parsed.netloc}/{href}"
