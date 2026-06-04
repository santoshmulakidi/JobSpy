from __future__ import annotations

import logging
import re
from datetime import date
from collections.abc import Sequence

import requests

from collectors.base import CollectionRequest, CollectionResult, Collector, now_utc
from collectors.dedup import deduplicate_jobs

logger = logging.getLogger(__name__)


class MarkdownJobCollector(Collector):
    def __init__(
        self,
        *,
        source_name: str,
        source_url: str,
        fallback_urls: Sequence[str] | None = None,
        timeout_seconds: int = 20,
        visa_friendly: bool = False,
    ) -> None:
        self.source_name = source_name
        self.source_url = source_url
        self.fallback_urls = list(fallback_urls or [])
        self.timeout_seconds = timeout_seconds
        self.visa_friendly = visa_friendly

    def collect(self, request: CollectionRequest) -> CollectionResult:
        started_at = now_utc()
        jobs: list[dict] = []
        errors: list[str] = []

        try:
            response = self._get_first_available()
            jobs = self._parse_markdown(response.text, request)
            if not jobs:
                errors.append(f"{self.source_name} returned no matching markdown jobs")
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

    def _get_first_available(self) -> requests.Response:
        last_error: requests.RequestException | None = None
        for url in [self.source_url, *self.fallback_urls]:
            try:
                response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=self.timeout_seconds)
                response.raise_for_status()
                self.source_url = url
                return response
            except requests.RequestException as exc:
                last_error = exc
                logger.warning("%s source URL failed: %s", self.source_name, url)
        if last_error:
            raise last_error
        raise requests.RequestException(f"{self.source_name} has no source URLs configured")

    def _parse_markdown(self, markdown: str, request: CollectionRequest) -> list[dict]:
        jobs: list[dict] = []
        headers: list[str] | None = None
        for line in markdown.splitlines():
            if not line.strip().startswith("|"):
                continue
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if not cells or all(re.fullmatch(r":?-{2,}:?", cell or "") for cell in cells):
                continue
            lowered = [cell.lower() for cell in cells]
            if "company" in lowered and any("title" in cell or "role" in cell for cell in lowered):
                headers = lowered
                continue
            if not headers or len(cells) < len(headers):
                continue
            row = dict(zip(headers, cells, strict=False))
            job = self._row_to_job(row, request)
            if job and self._matches(job, request):
                jobs.append(job)
        return jobs

    def _row_to_job(self, row: dict[str, str], request: CollectionRequest) -> dict | None:
        company = row.get("company")
        title = row.get("job title") or row.get("title") or row.get("role")
        location = row.get("location") or request.location
        link_text = row.get("link") or row.get("application") or row.get("apply")
        job_url = self._extract_url(link_text) or self._extract_url(" ".join(row.values()))
        if not title or not company:
            return None
        h1b_status = row.get("h1b status") or row.get("h1b") or row.get("visa")
        posted = row.get("date posted") or row.get("date")
        description = " | ".join(f"{key}: {value}" for key, value in row.items() if value)
        return {
            "id": f"{self.source_name}-{abs(hash((company, title, job_url)))}",
            "site": self.source_name,
            "job_url": job_url,
            "job_url_direct": job_url,
            "title": self._strip_markdown(title),
            "company": self._strip_markdown(company),
            "location": self._strip_markdown(location),
            "description": self._strip_markdown(description),
            "is_remote": "remote" in str(location or "").lower(),
            "date_posted": self._date(posted),
            "raw": {
                "source_url": self.source_url,
                "h1b_status": h1b_status,
                "visa_friendly_source": self.visa_friendly,
            },
        }

    def _matches(self, job: dict, request: CollectionRequest) -> bool:
        text = " ".join(str(job.get(key) or "") for key in ("title", "company", "location", "description")).lower()
        terms = [
            term.lower()
            for term in re.findall(r"[A-Za-z0-9.#]+", request.search_term)
            if term.lower() not in {"or", "and", "the", "in", "posted", "past", "full", "time"}
        ]
        if terms and not any(term in text for term in terms):
            return False
        if request.is_remote and not job.get("is_remote"):
            return False
        return True

    @staticmethod
    def _extract_url(value: str | None) -> str | None:
        if not value:
            return None
        markdown_link = re.search(r"\[[^\]]+\]\((https?://[^)]+)\)", value)
        if markdown_link:
            return markdown_link.group(1)
        plain = re.search(r"https?://[^\s)]+", value)
        return plain.group(0) if plain else None

    @staticmethod
    def _strip_markdown(value: str | None) -> str | None:
        if value is None:
            return None
        value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
        return " ".join(value.replace("🏅", "H1B explicitly mentioned").replace("🥈", "H1B sponsor history").split())

    @staticmethod
    def _date(value: str | None) -> str | None:
        if not value:
            return None
        match = re.search(r"\d{4}-\d{2}-\d{2}", value)
        if not match:
            return None
        try:
            return date.fromisoformat(match.group(0)).isoformat()
        except ValueError:
            return None
