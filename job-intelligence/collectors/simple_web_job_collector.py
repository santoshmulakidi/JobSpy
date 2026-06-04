from __future__ import annotations

import logging
from urllib.parse import quote_plus, urlparse

import requests
from bs4 import BeautifulSoup

from collectors.base import CollectionRequest, CollectionResult, Collector, now_utc
from collectors.dedup import deduplicate_jobs

logger = logging.getLogger(__name__)


class SimpleWebJobCollector(Collector):
    def __init__(self, *, source_name: str, search_url_template: str, timeout_seconds: int = 20) -> None:
        self.source_name = source_name
        self.search_url_template = search_url_template
        self.timeout_seconds = timeout_seconds

    def collect(self, request: CollectionRequest) -> CollectionResult:
        started_at = now_utc()
        url = self._search_url(request)
        jobs: list[dict] = []
        errors: list[str] = []

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
                errors.append(f"{self.source_name} blocked automated access; this source is experimental")
            elif response.status_code >= 400:
                errors.append(f"{self.source_name} returned HTTP {response.status_code}")
            else:
                jobs = self._parse_jobs(response.text, request, response.url)
                if not jobs:
                    errors.append(f"{self.source_name} returned no parseable jobs")
        except requests.RequestException as exc:
            logger.exception("%s collection failed", self.source_name)
            errors.append(f"{self.source_name} request failed: {exc}")

        return CollectionResult(
            request=request,
            run_started_at=started_at,
            run_finished_at=now_utc(),
            jobs=deduplicate_jobs(jobs)[: request.results_wanted],
            errors=errors,
        )

    def _search_url(self, request: CollectionRequest) -> str:
        return self.search_url_template.format(
            query=quote_plus(request.search_term),
            location=quote_plus(request.location or "United States"),
        )

    def _parse_jobs(self, html: str, request: CollectionRequest, source_url: str) -> list[dict]:
        soup = BeautifulSoup(html, "html.parser")
        jobs: list[dict] = []
        seen: set[str] = set()
        for link in soup.select("a[href]"):
            href = link.get("href")
            title = " ".join(link.get_text(" ", strip=True).split())
            if not href or not title or not self._looks_like_job(href, title):
                continue
            href = self._absolute_url(source_url, href)
            if href in seen:
                continue
            seen.add(href)
            card = self._nearest_card(link)
            card_text = " ".join(card.get_text(" ", strip=True).split()) if card else title
            if not self._matches(title, card_text, request):
                continue
            jobs.append(
                {
                    "id": f"{self.source_name}-{abs(hash(href))}",
                    "site": self.source_name,
                    "job_url": href,
                    "job_url_direct": href,
                    "title": title[:500],
                    "company": self._company_from_card(card_text, title),
                    "location": request.location,
                    "description": card_text,
                    "is_remote": request.is_remote or "remote" in card_text.lower(),
                    "raw": {"source_url": source_url, "card_text": card_text},
                }
            )
            if len(jobs) >= request.results_wanted:
                break
        return jobs

    def _matches(self, title: str, card_text: str, request: CollectionRequest) -> bool:
        text = f"{title} {card_text}".lower()
        terms = [term.lower() for term in request.search_term.split() if len(term) > 2]
        return not terms or any(term in text for term in terms)

    def _looks_like_job(self, href: str, title: str) -> bool:
        value = f"{href} {title}".lower()
        return any(token in value for token in ("job", "career", "position", "opening", "role"))

    @staticmethod
    def _absolute_url(source_url: str, href: str) -> str:
        if href.startswith("http"):
            return href
        parsed = urlparse(source_url)
        if href.startswith("/"):
            return f"{parsed.scheme}://{parsed.netloc}{href}"
        return f"{parsed.scheme}://{parsed.netloc}/{href}"

    @staticmethod
    def _nearest_card(link):
        for parent in link.parents:
            if parent.name in {"article", "li", "section", "div"}:
                text = parent.get_text(" ", strip=True)
                if len(text) > 40:
                    return parent
        return None

    @staticmethod
    def _company_from_card(card_text: str, title: str) -> str | None:
        cleaned = card_text.replace(title, "", 1).strip(" -|")
        return cleaned.split(" · ", 1)[0].split(" | ", 1)[0][:255] or None
