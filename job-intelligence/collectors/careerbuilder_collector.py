from __future__ import annotations

import logging
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup

from collectors.base import CollectionRequest, CollectionResult, Collector, now_utc
from collectors.dedup import deduplicate_jobs

logger = logging.getLogger(__name__)


class CareerBuilderCollector(Collector):
    source_name = "careerbuilder"
    base_url = "https://www.careerbuilder.com"

    def __init__(self, timeout_seconds: int = 20) -> None:
        self.timeout_seconds = timeout_seconds

    def collect(self, request: CollectionRequest) -> CollectionResult:
        started_at = now_utc()
        errors: list[str] = []
        jobs: list[dict] = []
        url = self._search_url(request)

        try:
            response = requests.get(
                url,
                timeout=self.timeout_seconds,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/125.0 Safari/537.36"
                    ),
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
            )
            if response.status_code == 403:
                errors.append(
                    "careerbuilder blocked automated access with a JavaScript challenge; "
                    "this source needs a browser-assisted or partner/API connector"
                )
            elif response.status_code >= 400:
                errors.append(f"careerbuilder returned HTTP {response.status_code}")
            else:
                jobs = self._parse_jobs(response.text, request, response.url)
                if not jobs:
                    errors.append("careerbuilder returned no parseable jobs")
        except requests.RequestException as exc:
            logger.exception("careerbuilder collection failed")
            errors.append(f"careerbuilder request failed: {exc}")

        return CollectionResult(
            request=request,
            run_started_at=started_at,
            run_finished_at=now_utc(),
            jobs=deduplicate_jobs(jobs)[: request.results_wanted],
            errors=errors,
        )

    def _search_url(self, request: CollectionRequest) -> str:
        query = quote_plus(request.search_term)
        location = quote_plus("remote" if request.is_remote else (request.location or ""))
        return f"{self.base_url}/jobs?keywords={query}&location={location}"

    def _parse_jobs(
        self,
        html: str,
        request: CollectionRequest,
        source_url: str,
    ) -> list[dict]:
        soup = BeautifulSoup(html, "html.parser")
        jobs: list[dict] = []
        seen_urls: set[str] = set()

        for link in soup.select("a[href*='/job/'], a[href*='/jobs/']"):
            title = " ".join(link.get_text(" ", strip=True).split())
            href = link.get("href")
            if not title or not href:
                continue
            if href.startswith("/"):
                href = f"{self.base_url}{href}"
            if href in seen_urls or "careerbuilder.com" not in href:
                continue
            seen_urls.add(href)

            card = self._nearest_card(link)
            card_text = " ".join(card.get_text(" ", strip=True).split()) if card else title
            company = self._extract_company(card_text, title)

            jobs.append(
                {
                    "id": f"careerbuilder-{abs(hash(href))}",
                    "site": self.source_name,
                    "job_url": href,
                    "job_url_direct": href,
                    "title": title,
                    "company": company,
                    "location": request.location,
                    "description": card_text,
                    "is_remote": request.is_remote or "remote" in card_text.lower(),
                    "raw": {
                        "source_url": source_url,
                        "card_text": card_text,
                    },
                }
            )

            if len(jobs) >= request.results_wanted:
                break

        return jobs

    @staticmethod
    def _nearest_card(link):
        for parent in link.parents:
            if parent.name in {"article", "li", "section", "div"}:
                text = parent.get_text(" ", strip=True)
                if len(text) > 40:
                    return parent
        return None

    @staticmethod
    def _extract_company(card_text: str, title: str) -> str | None:
        cleaned = card_text.replace(title, "", 1).strip(" -|")
        if not cleaned:
            return None
        separators = [" | ", " - ", " · "]
        for separator in separators:
            if separator in cleaned:
                return cleaned.split(separator, 1)[0][:255] or None
        return cleaned.split("  ", 1)[0][:255] or None
