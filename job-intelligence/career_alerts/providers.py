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
from types import MethodType
from typing import Any, Protocol, Self
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
from ats_scrapers.exceptions import CompanyNotFoundError
from ats_scrapers.scrapers import get_scraper

from career_alerts.matching import ai_title_needs_supporting_description
from career_alerts.types import CareerJob, SponsorTarget

REQUEST_TIMEOUT_SECONDS = 25.0
SOURCE_TIMEOUT_SECONDS = 60.0
MAX_PAGES_PER_SOURCE = 20
MAX_JOBS_PER_SOURCE = 1000
MAX_DETAIL_CANDIDATES_PER_SOURCE = 25
MAX_ATTEMPTS = 3
RETRYABLE_HTTP_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})
# With MAX_ATTEMPTS=3, only the waits before attempts 2 and 3 are reachable.
# The complete specified schedule is retained here; 9 seconds would precede a
# fourth attempt and is deliberately unreachable under the total-attempt cap.
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


class _RequestController:
    """Apply shared limits to every actual HTTP request, including fan-out."""

    def __init__(
        self,
        concurrency: int,
        per_host: int,
        client_factory: Callable[..., object],
    ) -> None:
        self.global_semaphore = asyncio.Semaphore(concurrency)
        self.per_host = per_host
        self.host_semaphores: dict[str, asyncio.Semaphore] = {}
        self.client_factory = client_factory

    def client(self, **kwargs: object) -> _ControlledHttpClient:
        return _ControlledHttpClient(self, self.client_factory(**kwargs))

    async def request(self, raw_client: object, method: str, url: str, **kwargs: object):
        host = urlparse(url).hostname or url
        host_semaphore = self.host_semaphores.setdefault(
            host, asyncio.Semaphore(self.per_host)
        )
        # Take the narrower host permit first so requests queued for one host
        # do not occupy scarce global permits needed by other hosts.
        async with host_semaphore, self.global_semaphore:
            return await raw_client.request(method, url, **kwargs)  # type: ignore[attr-defined]


class _ControlledHttpClient:
    """Small httpx-compatible client whose requests use the shared controller."""

    def __init__(self, controller: _RequestController, raw_client: object) -> None:
        self.controller = controller
        self.raw_client = raw_client

    async def __aenter__(self) -> Self:
        enter = getattr(self.raw_client, "__aenter__", None)
        if enter is not None:
            await enter()
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        exit_method = getattr(self.raw_client, "__aexit__", None)
        if exit_method is not None:
            await exit_method(exc_type, exc, traceback)
        else:
            await self.aclose()

    async def aclose(self) -> None:
        close = getattr(self.raw_client, "aclose", None)
        if close is not None:
            await close()

    async def request(self, method: str, url: str, **kwargs: object):
        return await self.controller.request(self.raw_client, method, url, **kwargs)

    async def get(self, url: str, **kwargs: object):
        return await self.request("GET", url, **kwargs)

    async def post(self, url: str, **kwargs: object):
        return await self.request("POST", url, **kwargs)


class _ControlledFetcher:
    """ats-scrapers fetch API with exactly one network attempt per call."""

    def __init__(self, controller: _RequestController, **client_kwargs: object) -> None:
        self.client = controller.client(**client_kwargs)

    async def __aenter__(self) -> Self:
        await self.client.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        await self.client.__aexit__(exc_type, exc, traceback)

    async def request(
        self,
        method: str,
        url: str,
        *,
        handled: frozenset[int] | set[int] = frozenset(),
        **kwargs: object,
    ):
        response = await self.client.request(method, url, **kwargs)
        status = response.status_code
        if status in handled or 200 <= status < 300:
            return response
        if status == 404:
            raise CompanyNotFoundError(f"ATS source not found: {url}")
        raise _StatusError(status, f"ATS source returned HTTP {status}: {url}")

    async def get_json(self, url: str, **kwargs: object):
        return (await self.request("GET", url, **kwargs)).json()

    async def post_json(self, url: str, *, json: object = None, **kwargs: object):
        return (await self.request("POST", url, json=json, **kwargs)).json()

    async def get_text(self, url: str, **kwargs: object) -> str:
        return (await self.request("GET", url, **kwargs)).text


class CareerProvider:
    """Fetch and normalize one source group without coordinating retries."""

    def __init__(
        self,
        *,
        scraper_factory: Callable[..., object] = get_scraper,
        crawler_factory: Callable[[], object] | None = None,
        http_client_factory: Callable[..., object] = httpx.AsyncClient,
        max_pages_per_source: int = MAX_PAGES_PER_SOURCE,
        max_jobs_per_source: int = MAX_JOBS_PER_SOURCE,
        max_detail_candidates_per_source: int = MAX_DETAIL_CANDIDATES_PER_SOURCE,
    ) -> None:
        if (
            max_pages_per_source < 1
            or max_jobs_per_source < 1
            or max_detail_candidates_per_source < 0
        ):
            raise ValueError(
                "provider page/job caps must be positive and detail cap non-negative"
            )
        self._scraper_factory = scraper_factory
        self._crawler_factory = crawler_factory
        self._http_client_factory = http_client_factory
        self._max_pages_per_source = max_pages_per_source
        self._max_jobs_per_source = max_jobs_per_source
        self._max_detail_candidates_per_source = max_detail_candidates_per_source
        self._request_controller = _RequestController(6, 2, http_client_factory)

    def configure_request_limits(self, concurrency: int, per_host: int) -> None:
        """Bind actual adapter requests to this collection's shared limits."""
        self._request_controller = _RequestController(
            concurrency, per_host, self._http_client_factory
        )

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
            include_descriptions=False,
        )
        self._bind_controlled_http(scraper, target.provider)
        # ats-scrapers 0.2.0's Workday constructor accepts the provider key,
        # while its fetcher parses the complete reviewed careers URL.
        if target.provider == "workday" and hasattr(scraper, "company_slug"):
            scraper.company_slug = target.career_url  # type: ignore[attr-defined]
        raw_jobs = list(await scraper.afetch())[: self._max_jobs_per_source]  # type: ignore[attr-defined]
        await self._enrich_candidate_details(scraper, target, raw_jobs)
        return self.normalize_jobs(targets, raw_jobs)

    def _bind_controlled_http(self, scraper: object, provider: str | None) -> None:
        controller = self._request_controller

        def make_fetcher(_scraper, **overrides: object) -> _ControlledFetcher:
            kwargs = {
                "timeout": overrides.get("timeout", REQUEST_TIMEOUT_SECONDS),
                "follow_redirects": True,
            }
            headers = overrides.get("headers")
            proxy = overrides.get("proxy")
            if headers:
                kwargs["headers"] = headers
            if proxy:
                kwargs["proxy"] = proxy
            return _ControlledFetcher(controller, **kwargs)

        scraper.make_fetcher = MethodType(make_fetcher, scraper)  # type: ignore[attr-defined]
        if provider == "workday":
            self._bind_workday_http(scraper)
        elif provider == "avature":
            self._bind_avature_http(scraper)
        elif provider == "eightfold":
            self._bind_eightfold_http(scraper)
        elif provider == "smartrecruiters":
            self._bind_smartrecruiters_http(scraper)

    def _bind_smartrecruiters_http(self, scraper: object) -> None:
        max_jobs = self._max_jobs_per_source
        max_pages = self._max_pages_per_source

        async def fetch_bounded(_scraper):
            url_template = _scraper_module_constant(_scraper, "API_TEMPLATE")
            page_limit = _scraper_module_constant(_scraper, "PAGE_LIMIT")
            url = url_template.format(slug=_scraper.company_slug)
            all_jobs: list[object] = []
            async with _scraper.make_fetcher() as fetch:
                for page in range(max_pages):
                    content = (
                        await fetch.get_json(
                            url,
                            params={"limit": page_limit, "offset": page * page_limit},
                        )
                    ).get("content", [])
                    remaining = max_jobs - len(all_jobs)
                    all_jobs.extend(
                        _scraper._parse_job(item) for item in content[:remaining]
                    )
                    if len(content) < page_limit or len(all_jobs) >= max_jobs:
                        break
            return all_jobs

        scraper.afetch = MethodType(fetch_bounded, scraper)  # type: ignore[attr-defined]

    async def _enrich_candidate_details(
        self,
        scraper: object,
        target: SponsorTarget,
        raw_jobs: list[object],
    ) -> None:
        indices = [
            index
            for index, job in enumerate(raw_jobs)
            if not getattr(job, "description", None)
            and ai_title_needs_supporting_description(str(getattr(job, "title", "")))
        ][: self._max_detail_candidates_per_source]
        if not indices:
            return
        candidates = [raw_jobs[index] for index in indices]
        sem = asyncio.Semaphore(1000)
        if target.provider in {"smartrecruiters", "workable"}:
            method_name = (
                "_enrich_detail"
                if target.provider == "smartrecruiters"
                else "_enrich_description"
            )
            async with scraper.make_fetcher() as fetch:  # type: ignore[attr-defined]
                await asyncio.gather(
                    *(
                        getattr(scraper, method_name)(fetch, sem, job)
                        for job in candidates
                    )
                )
            return
        if target.provider not in {"avature", "eightfold", "workday"}:
            return
        async with self._request_controller.client(
            timeout=REQUEST_TIMEOUT_SECONDS,
            follow_redirects=True,
        ) as client:
            if target.provider == "avature":
                await asyncio.gather(
                    *(scraper._enrich_with_detail(client, sem, job) for job in candidates)  # type: ignore[attr-defined]
                )
            elif target.provider == "eightfold":
                await asyncio.gather(
                    *(
                        scraper._enrich_position_details(client, sem, job)  # type: ignore[attr-defined]
                        for job in candidates
                    )
                )
            elif target.provider == "workday":
                detail_prefix = _workday_detail_prefix(target.career_url or "")
                await scraper._enrich_details(client, sem, detail_prefix, candidates)  # type: ignore[attr-defined]
                for index, enriched in zip(indices, candidates, strict=True):
                    raw_jobs[index] = enriched

    def _bind_workday_http(self, scraper: object) -> None:
        controller = self._request_controller
        max_jobs = self._max_jobs_per_source
        max_pages = self._max_pages_per_source

        async def fetch_all(_scraper, api, base, company, detail_prefix):
            async with controller.client(
                timeout=REQUEST_TIMEOUT_SECONDS, follow_redirects=True
            ) as client:
                sem = asyncio.Semaphore(1000)
                seen: set[str] = set()
                all_jobs: list[object] = []

                def absorb(postings):
                    for posting in postings:
                        job = _scraper._parse_job(posting, base, company)
                        key = job.ats_id or str(job.url)
                        if key not in seen:
                            seen.add(key)
                            all_jobs.append(job)

                first = await _scraper._request(
                    client, api, sem, applied_facets={}, offset=0
                )
                if first is not None:
                    absorb((first.get("jobPostings") or [])[:max_jobs])
                    page_size = _scraper_module_constant(_scraper, "PAGE_LIMIT")
                    total = min(int(first.get("total", 0)), max_jobs)
                    offsets = list(range(page_size, total, page_size))[: max_pages - 1]
                    pages = await asyncio.gather(
                        *(
                            _scraper._request(
                                client,
                                api,
                                sem,
                                applied_facets={},
                                offset=offset,
                            )
                            for offset in offsets
                        )
                    )
                    for page in pages:
                        absorb((page or {}).get("jobPostings") or [])
                        if len(all_jobs) >= max_jobs:
                            del all_jobs[max_jobs:]
                            break
                if _scraper.include_descriptions:
                    await _scraper._enrich_details(client, sem, detail_prefix, all_jobs)
                return all_jobs

        async def request_once(
            _scraper, client, api, sem, *, applied_facets, offset
        ):
            _scraper._check_deadline()
            body = {
                "appliedFacets": applied_facets,
                "limit": 20,
                "offset": offset,
                "searchText": "",
            }
            async with sem:
                response = await client.post(
                    api, json=body, headers={"Content-Type": "application/json"}
                )
            if response.status_code == 404:
                raise CompanyNotFoundError(
                    f"Workday site not found: {_scraper.company_slug}"
                )
            if response.status_code != 200:
                raise _StatusError(
                    response.status_code,
                    f"Workday returned HTTP {response.status_code}",
                )
            return response.json()

        scraper._fetch_all = MethodType(fetch_all, scraper)  # type: ignore[attr-defined]
        scraper._request = MethodType(request_once, scraper)  # type: ignore[attr-defined]

    def _bind_avature_http(self, scraper: object) -> None:
        controller = self._request_controller
        max_jobs = self._max_jobs_per_source
        max_pages = self._max_pages_per_source

        async def fetch_direct(_scraper, base, company):
            seen: set[str] = set()
            all_jobs: list[object] = []
            async with controller.client(
                timeout=REQUEST_TIMEOUT_SECONDS, follow_redirects=True
            ) as client:
                page_size = _scraper_module_constant(_scraper, "_page_size")(base)
                provider_max_pages = _scraper_module_constant(_scraper, "MAX_PAGES")
                for page_num in range(min(provider_max_pages, max_pages)):
                    html_text = await _scraper._fetch_page(
                        client, base, page_num * page_size
                    )
                    page_jobs = _scraper._parse_page(html_text, base, company)
                    new_jobs = [job for job in page_jobs if job.ats_id not in seen]
                    if not new_jobs:
                        break
                    remaining = max_jobs - len(all_jobs)
                    accepted_jobs = new_jobs[:remaining]
                    for job in accepted_jobs:
                        seen.add(job.ats_id)
                    all_jobs.extend(accepted_jobs)
                    if len(all_jobs) >= max_jobs or len(page_jobs) < page_size:
                        break
                if _scraper.include_descriptions and all_jobs:
                    sem = asyncio.Semaphore(1000)
                    await asyncio.gather(
                        *(
                            _scraper._enrich_with_detail(client, sem, job)
                            for job in all_jobs
                        )
                    )
            return all_jobs

        async def fetch_page_once(_scraper, client, base, offset):
            url = _scraper_module_constant(_scraper, "_paginated_search_url")(
                base, offset
            )
            headers = _scraper_module_constant(_scraper, "_BROWSER_HEADERS")
            response = await client.get(url, headers=headers)
            if response.status_code == 404:
                raise CompanyNotFoundError(f"Avature site not found: {base}")
            if response.status_code != 200:
                raise _StatusError(
                    response.status_code,
                    f"Avature returned HTTP {response.status_code}",
                )
            return response.text

        scraper._fetch_direct = MethodType(fetch_direct, scraper)  # type: ignore[attr-defined]
        scraper._fetch_page = MethodType(fetch_page_once, scraper)  # type: ignore[attr-defined]

    def _bind_eightfold_http(self, scraper: object) -> None:
        controller = self._request_controller
        max_jobs = self._max_jobs_per_source
        max_pages = self._max_pages_per_source
        scraper.client_kind = "httpx"  # type: ignore[attr-defined]

        async def fetch_via_httpx(_scraper, seen, all_jobs):
            async with controller.client(
                timeout=REQUEST_TIMEOUT_SECONDS, follow_redirects=True
            ) as client:
                first = await _scraper._fetch_page_httpx(client, start=0)
                _scraper._collect(first.get("positions") or [], seen, all_jobs)
                count = min(int(first.get("count") or 0), max_jobs)
                page_size = _scraper_module_constant(_scraper, "PAGE_SIZE")
                if count > page_size:
                    offsets = list(range(page_size, count, page_size))[: max_pages - 1]
                    await asyncio.gather(
                        *(
                            _collect_eightfold_page(
                                _scraper, client, offset, seen, all_jobs
                            )
                            for offset in offsets
                        )
                    )
                del all_jobs[max_jobs:]
                if _scraper.include_descriptions and all_jobs:
                    sem = asyncio.Semaphore(1000)
                    await asyncio.gather(
                        *(
                            _scraper._enrich_position_details(client, sem, job)
                            for job in all_jobs
                        )
                    )

        async def fetch_page_once(_scraper, client, *, start):
            response = await client.get(
                f"{_scraper.base_url}/api/pcsx/search",
                params={
                    "domain": _scraper.domain,
                    "query": "",
                    "location": "",
                    "start": start,
                    "sort_by": "timestamp",
                },
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Accept": "application/json, text/plain, */*",
                },
            )
            if response.status_code != 200:
                raise _StatusError(
                    response.status_code,
                    f"Eightfold returned HTTP {response.status_code}",
                )
            return response.json().get("data") or {}

        scraper._fetch_via_httpx = MethodType(fetch_via_httpx, scraper)  # type: ignore[attr-defined]
        scraper._fetch_page_httpx = MethodType(fetch_page_once, scraper)  # type: ignore[attr-defined]

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
            max_retries=0,
            semaphore_count=1,
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
            raw_apply_url = str(
                getattr(raw, "apply_url", None) or raw.url  # type: ignore[attr-defined]
            )
            provider_job_id = str(
                getattr(raw, "ats_id", None)
                or getattr(raw, "global_id", None)
                or _stable_url_id(raw_apply_url)
            )
            apply_url = _approved_apply_url(
                target,
                raw_apply_url,
                provider_job_id,
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
    source_timeout_seconds: float = SOURCE_TIMEOUT_SECONDS,
) -> list[FetchResult]:
    """Fetch each verified source once with bounded retries and isolation."""
    if concurrency < 1 or per_host < 1 or source_timeout_seconds <= 0:
        raise ValueError("concurrency, per_host, and source timeout must be positive")
    grouped: dict[str, list[SponsorTarget]] = {}
    for target in targets:
        if target.mapping_status == "verified":
            grouped.setdefault(target.source_key, []).append(target)
    if not grouped:
        return []

    provider_client = client or CareerProvider()
    configure_limits = getattr(provider_client, "configure_request_limits", None)
    if configure_limits is not None:
        configure_limits(concurrency, per_host)

    async def run_source(source_targets: list[SponsorTarget]) -> FetchResult:
        target = source_targets[0]
        started = perf_counter()
        deadline = asyncio.get_running_loop().time() + source_timeout_seconds
        last_result: FetchResult | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    raise TimeoutError
                result = await asyncio.wait_for(
                    provider_client.fetch(source_targets), timeout=remaining
                )
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
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return replace(last_result, error_code="timeout")
            try:
                await asyncio.wait_for(sleep(delay), timeout=remaining)
            except TimeoutError:
                return replace(
                    last_result,
                    elapsed_ms=_elapsed_ms(started),
                    error_code="timeout",
                )
        assert last_result is not None
        return last_result

    direct_groups = [
        group for group in grouped.values() if group[0].provider != "custom"
    ]
    custom_groups = [
        group for group in grouped.values() if group[0].provider == "custom"
    ]
    direct_results = await asyncio.gather(*(run_source(group) for group in direct_groups))
    custom_global = asyncio.Semaphore(concurrency)
    custom_hosts: dict[str, asyncio.Semaphore] = {}

    async def run_custom(group: list[SponsorTarget]) -> FetchResult:
        host = urlparse(group[0].career_url or "").hostname or group[0].source_key
        host_semaphore = custom_hosts.setdefault(host, asyncio.Semaphore(per_host))
        # Crawl4AI is configured for one internal request at a time, so these
        # source permits are also effective request permits for custom pages.
        async with host_semaphore, custom_global:
            return await run_source(group)

    custom_results = await asyncio.gather(*(run_custom(group) for group in custom_groups))
    return [*direct_results, *custom_results]


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
    if "not found" in message.casefold() or "missing" in message.casefold():
        return "http_404"
    if isinstance(exc, ValueError) or "registry validation" in message.casefold():
        return "registry_validation"
    return "provider_error"


def _looks_like_job_link(title: str, url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        return False
    candidate = f"{title} {parsed.path}".casefold()
    return any(token in candidate for token in ("job", "career", "position", "opening", "role"))


def _approved_apply_url(
    target: SponsorTarget, apply_url: str, provider_job_id: str
) -> str:
    """Upgrade reviewed same-host or strongly identified Block job links."""
    career = urlparse(target.career_url or "")
    job = urlparse(apply_url)
    if career.scheme != "https" or job.scheme != "http" or not job.hostname:
        return apply_url
    same_reviewed_host = bool(
        career.hostname
        and career.hostname.casefold() == job.hostname.casefold()
    )
    path_parts = [part for part in job.path.rstrip("/").split("/") if part]
    career_parts = [
        part for part in career.path.rstrip("/").split("/") if part
    ]
    block_greenhouse_identity = (
        target.provider == "greenhouse"
        and target.provider_key == "block"
        and career.hostname
        and career.hostname.casefold() in {
            "boards.greenhouse.io",
            "job-boards.greenhouse.io",
        }
        and career_parts == ["block"]
        and job.hostname.casefold() == "block.xyz"
        and path_parts[-3:] == ["careers", "jobs", provider_job_id]
        and parse_qs(job.query, keep_blank_values=True).get("gh_jid")
        == [provider_job_id]
    )
    if same_reviewed_host or block_greenhouse_identity:
        return job._replace(scheme="https").geturl()
    return apply_url


def _stable_url_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:20]


def _elapsed_ms(started: float) -> int:
    return max(0, round((perf_counter() - started) * 1000))


def _scraper_module_constant(scraper: object, name: str) -> Any:
    module = __import__(type(scraper).__module__, fromlist=[name])
    return getattr(module, name)


def _workday_detail_prefix(career_url: str) -> str:
    parsed = urlparse(career_url)
    company = (parsed.hostname or "").split(".", 1)[0]
    site = parsed.path.strip("/").split("/", 1)[0]
    return f"{parsed.scheme}://{parsed.netloc}/wday/cxs/{company}/{site}"


async def _collect_eightfold_page(scraper, client, offset, seen, all_jobs) -> None:
    page = await scraper._fetch_page_httpx(client, start=offset)
    scraper._collect(page.get("positions") or [], seen, all_jobs)
