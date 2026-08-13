"""Bounded collection from reviewed career-source providers."""

from __future__ import annotations

import asyncio
import hashlib
import json
import random
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, replace
from time import perf_counter
from typing import Protocol
from urllib.parse import urljoin, urlparse

from ats_scrapers.scrapers import get_scraper

from career_alerts.types import CareerJob, SponsorTarget

REQUEST_TIMEOUT_SECONDS = 25.0
MAX_ATTEMPTS = 3
RETRYABLE_HTTP_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})
RETRY_DELAYS = (1.0, 3.0, 9.0)
_HTTP_STATUS_RE = re.compile(
    r"\b(?:HTTP|returned|status(?:[_ ]code)?[=:]?)\s*(\d{3})\b",
    re.IGNORECASE,
)
_CAPTCHA_RE = re.compile(
    r"\b(?:captcha|challenge page|bot challenge)\b", re.IGNORECASE
)


@dataclass(frozen=True)
class FetchResult:
    """Outcome of fetching one unique reviewed career source."""

    source_key: str
    jobs: tuple[CareerJob, ...]
    elapsed_ms: int
    attempt_count: int
    error_code: str | None


class ProviderClient(Protocol):
    async def fetch(self, targets: list[SponsorTarget]) -> FetchResult: ...


class _StatusError(RuntimeError):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


class CareerProvider:
    """Fetch and normalize one source group without coordinating retries."""

    def __init__(
        self,
        *,
        scraper_factory: Callable[..., object] = get_scraper,
        crawler_factory: Callable[[], object] | None = None,
    ) -> None:
        self._scraper_factory = scraper_factory
        self._crawler_factory = crawler_factory

    async def fetch(self, targets: list[SponsorTarget]) -> FetchResult:
        started = perf_counter()
        source_key = targets[0].source_key if targets else "registry:empty"
        try:
            target = self._validate_source_group(targets)
            if target.provider == "custom":
                jobs = await self._fetch_custom(targets)
            else:
                jobs = await self._fetch_ats(targets)
            error_code = None if jobs else "no_open_jobs"
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - provider failures become isolated results
            jobs = ()
            error_code = _error_code(exc)
        return FetchResult(
            source_key=source_key,
            jobs=jobs,
            elapsed_ms=_elapsed_ms(started),
            attempt_count=1,
            error_code=error_code,
        )

    @staticmethod
    def _validate_source_group(targets: list[SponsorTarget]) -> SponsorTarget:
        if not targets:
            raise ValueError("registry validation: source group cannot be empty")
        first = targets[0]
        if any(item.source_key != first.source_key for item in targets):
            raise ValueError("registry validation: targets must share one source_key")
        if any(item.mapping_status != "verified" for item in targets):
            raise ValueError("registry validation: only verified targets may be fetched")
        if not first.provider or not first.provider_key or not first.career_url:
            raise ValueError("registry validation: verified source fields are incomplete")
        if not first.career_url.startswith("https://"):
            raise ValueError("registry validation: career_url must use HTTPS")
        return first

    async def _fetch_ats(self, targets: list[SponsorTarget]) -> tuple[CareerJob, ...]:
        target = targets[0]
        scraper = self._scraper_factory(
            target.provider,
            target.provider_key,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        # ats-scrapers 0.2.0's Workday constructor accepts the provider key,
        # while its fetcher parses the complete reviewed careers URL.
        if target.provider == "workday" and hasattr(scraper, "company_slug"):
            scraper.company_slug = target.career_url  # type: ignore[attr-defined]
        raw_jobs = await scraper.afetch()  # type: ignore[attr-defined]
        return self.normalize_jobs(targets, raw_jobs)

    async def _fetch_custom(self, targets: list[SponsorTarget]) -> tuple[CareerJob, ...]:
        from crawl4ai import (
            AsyncWebCrawler,
            BrowserConfig,
            CacheMode,
            CrawlerRunConfig,
            JsonCssExtractionStrategy,
        )
        from crawl4ai.deep_crawling import BFSDeepCrawlStrategy

        target = targets[0]
        schema = {
            "name": "Career page links",
            "baseSelector": "a[href]",
            "baseFields": [
                {"name": "title", "type": "text", "transform": "strip"},
                {"name": "href", "type": "attribute", "attribute": "href"},
            ],
            "fields": [],
        }
        config = CrawlerRunConfig(
            cache_mode=CacheMode.ENABLED,
            page_timeout=int(REQUEST_TIMEOUT_SECONDS * 1000),
            extraction_strategy=JsonCssExtractionStrategy(schema),
            deep_crawl_strategy=BFSDeepCrawlStrategy(
                max_depth=3,
                max_pages=10,
                include_external=False,
            ),
        )
        crawler = (
            self._crawler_factory()
            if self._crawler_factory is not None
            else AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False))
        )
        rows: list[tuple[str, str]] = []
        async with crawler as active_crawler:  # type: ignore[attr-defined]
            crawled = await active_crawler.arun(url=target.career_url, config=config)
            try:
                pages = list(crawled)
            except TypeError:
                pages = [crawled]
            for page in pages:
                if not page.success:
                    status = page.status_code or 500
                    raise _StatusError(status, page.error_message or "custom crawl failed")
                try:
                    extracted = json.loads(page.extracted_content or "[]")
                except (TypeError, json.JSONDecodeError) as exc:
                    raise ValueError("custom CSS extraction returned invalid JSON") from exc
                if not isinstance(extracted, list):
                    raise TypeError("custom CSS extraction must return a list")
                base_url = getattr(page, "url", None) or target.career_url
                for item in extracted:
                    if not isinstance(item, dict):
                        continue
                    title = str(item.get("title") or "").strip()
                    href = str(item.get("href") or "").strip()
                    apply_url = urljoin(base_url, href)
                    if title and _looks_like_job_link(title, apply_url):
                        rows.append((title, apply_url))
        return self._normalize_custom_jobs(targets, rows)

    @staticmethod
    def normalize_jobs(
        targets: list[SponsorTarget], raw_jobs: Sequence[object]
    ) -> tuple[CareerJob, ...]:
        target = targets[0]
        sponsor_names = tuple(dict.fromkeys(item.sponsor_name for item in targets))
        jobs: list[CareerJob] = []
        for raw in raw_jobs:
            apply_url = str(getattr(raw, "apply_url", None) or raw.url)  # type: ignore[attr-defined]
            provider_job_id = str(
                getattr(raw, "ats_id", None)
                or getattr(raw, "global_id", None)
                or _stable_url_id(apply_url)
            )
            jobs.append(
                CareerJob(
                    source_key=target.source_key,
                    provider=target.provider or "",
                    provider_job_id=provider_job_id,
                    company=target.canonical_company,
                    sponsor_names=sponsor_names,
                    title=str(raw.title),  # type: ignore[attr-defined]
                    location=str(getattr(raw, "location", None) or ""),
                    description=str(getattr(raw, "description", None) or ""),
                    apply_url=apply_url,
                    posted_at=getattr(raw, "posted_at", None),
                    is_remote=getattr(raw, "is_remote", None) is True,
                )
            )
        return tuple(jobs)

    @staticmethod
    def _normalize_custom_jobs(
        targets: list[SponsorTarget], rows: Sequence[tuple[str, str]]
    ) -> tuple[CareerJob, ...]:
        target = targets[0]
        sponsor_names = tuple(dict.fromkeys(item.sponsor_name for item in targets))
        jobs: list[CareerJob] = []
        seen_urls: set[str] = set()
        for title, apply_url in rows:
            if apply_url in seen_urls:
                continue
            seen_urls.add(apply_url)
            jobs.append(
                CareerJob(
                    source_key=target.source_key,
                    provider="custom",
                    provider_job_id=_stable_url_id(apply_url),
                    company=target.canonical_company,
                    sponsor_names=sponsor_names,
                    title=title,
                    location="",
                    description="",
                    apply_url=apply_url,
                    posted_at=None,
                    is_remote=False,
                )
            )
        return tuple(jobs)


async def collect_sources(
    targets: list[SponsorTarget],
    concurrency: int = 6,
    per_host: int = 2,
    *,
    client: ProviderClient | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    jitter: Callable[[], float] = random.random,
) -> list[FetchResult]:
    """Fetch each verified source once with bounded retries and isolation."""
    if concurrency < 1 or per_host < 1:
        raise ValueError("concurrency and per_host must be positive")
    grouped: dict[str, list[SponsorTarget]] = {}
    for target in targets:
        if target.mapping_status == "verified":
            grouped.setdefault(target.source_key, []).append(target)
    if not grouped:
        return []

    provider_client = client or CareerProvider()
    global_semaphore = asyncio.Semaphore(concurrency)
    host_semaphores: dict[str, asyncio.Semaphore] = {}

    async def run_source(source_targets: list[SponsorTarget]) -> FetchResult:
        target = source_targets[0]
        host = urlparse(target.career_url or "").hostname or target.source_key
        host_semaphore = host_semaphores.setdefault(host, asyncio.Semaphore(per_host))
        started = perf_counter()
        last_result: FetchResult | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                async with global_semaphore, host_semaphore:
                    result = await provider_client.fetch(source_targets)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - isolate each source failure
                result = FetchResult(
                    source_key=target.source_key,
                    jobs=(),
                    elapsed_ms=0,
                    attempt_count=1,
                    error_code=_error_code(exc),
                )
            last_result = replace(
                result,
                source_key=target.source_key,
                elapsed_ms=_elapsed_ms(started),
                attempt_count=attempt,
            )
            if last_result.error_code not in _RETRYABLE_ERROR_CODES or attempt == MAX_ATTEMPTS:
                return last_result
            delay = RETRY_DELAYS[attempt - 1] + min(max(jitter(), 0.0), 1.0) * 0.5
            await sleep(delay)
        assert last_result is not None
        return last_result

    return list(await asyncio.gather(*(run_source(group) for group in grouped.values())))


_RETRYABLE_ERROR_CODES = frozenset(f"http_{status}" for status in RETRYABLE_HTTP_STATUSES)


def _error_code(exc: Exception) -> str:
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return "timeout"
    message = str(exc)
    if _CAPTCHA_RE.search(message):
        return "captcha"
    status = getattr(exc, "status_code", None)
    response = getattr(exc, "response", None)
    if not isinstance(status, int) and response is not None:
        status = getattr(response, "status_code", None)
    if not isinstance(status, int):
        match = _HTTP_STATUS_RE.search(message)
        status = int(match.group(1)) if match else None
    if isinstance(status, int):
        return f"http_{status}"
    if isinstance(exc, ValueError) or "registry validation" in message.casefold():
        return "registry_validation"
    return "provider_error"


def _looks_like_job_link(title: str, url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        return False
    candidate = f"{title} {parsed.path}".casefold()
    return any(token in candidate for token in ("job", "career", "position", "opening", "role"))


def _stable_url_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:20]


def _elapsed_ms(started: float) -> int:
    return max(0, round((perf_counter() - started) * 1000))
