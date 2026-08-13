import asyncio
from collections import defaultdict
from datetime import UTC, datetime
from types import SimpleNamespace
from urllib.parse import urlparse

import pytest

from career_alerts.providers import CareerProvider, FetchResult, collect_sources
from career_alerts.types import SponsorTarget


def target(
    provider="greenhouse",
    provider_key="acme",
    *,
    rank=1,
    sponsor_name="Acme LLC",
    career_url=None,
):
    default_urls = {
        "greenhouse": "https://job-boards.greenhouse.io/acme",
        "lever": "https://jobs.lever.co/acme",
        "workday": "https://acme.wd1.myworkdayjobs.com/acme",
        "custom": "https://careers.acme.test/jobs",
    }
    return SponsorTarget(
        rank=rank,
        sponsor_name=sponsor_name,
        canonical_company="Acme",
        total_approvals=10,
        career_url=career_url or default_urls[provider],
        provider=provider,
        provider_key=provider_key,
        mapping_status="verified",
        validation_notes="reviewed official source",
    )


def ats_job(provider, job_id, url):
    return SimpleNamespace(
        ats_type=provider,
        ats_id=job_id,
        url=url,
        apply_url=None,
        title="Senior Platform Engineer",
        company="Provider company",
        location="Dallas, TX",
        description=None,
        posted_at=datetime(2026, 8, 1, tzinfo=UTC),
        is_remote=None,
    )


@pytest.mark.parametrize(
    ("provider_name", "provider_key", "job_id", "job_url"),
    [
        ("greenhouse", "acme", 101, "https://job-boards.greenhouse.io/acme/jobs/101"),
        ("lever", "acme", "lever-2", "https://jobs.lever.co/acme/lever-2"),
        (
            "workday",
            "acme/acme",
            "R0003",
            "https://acme.wd1.myworkdayjobs.com/acme/job/Dallas/R0003",
        ),
    ],
)
def test_direct_ats_jobs_are_normalized(provider_name, provider_key, job_id, job_url):
    calls = []

    class FakeScraper:
        async def afetch(self):
            return [ats_job(provider_name, job_id, job_url)]

    def scraper_factory(provider, key, **kwargs):
        calls.append((provider, key, kwargs))
        return FakeScraper()

    source = target(provider_name, provider_key)
    result = asyncio.run(CareerProvider(scraper_factory=scraper_factory).fetch([source]))

    assert calls == [(provider_name, provider_key, {"timeout": 25.0})]
    assert result.error_code is None
    assert result.attempt_count == 1
    assert result.source_key == f"{provider_name}:{provider_key}"
    assert len(result.jobs) == 1
    job = result.jobs[0]
    assert job.provider == provider_name
    assert job.provider_job_id == str(job_id)
    assert job.apply_url == job_url
    assert job.company == "Acme"
    assert job.sponsor_names == ("Acme LLC",)
    assert job.description == ""
    assert job.is_remote is False


def test_custom_html_uses_cached_bounded_css_link_crawl():
    observed = {}

    class FakeCrawler:
        async def __aenter__(self):
            observed["entered"] = True
            return self

        async def __aexit__(self, *_args):
            observed["closed"] = True

        async def arun(self, *, url, config):
            observed["url"] = url
            observed["config"] = config
            return SimpleNamespace(
                success=True,
                extracted_content=(
                    '[{"title":"Senior AI Engineer",'
                    '"href":"/jobs/ai-42"}]'
                ),
                error_message=None,
                status_code=200,
            )

    source = target("custom", "acme-custom")
    result = asyncio.run(
        CareerProvider(crawler_factory=lambda: FakeCrawler()).fetch([source])
    )

    config = observed["config"]
    assert config.cache_mode.value == "enabled"
    assert config.deep_crawl_strategy.max_pages == 10
    assert config.deep_crawl_strategy.include_external is False
    assert config.max_retries == 0
    assert config.semaphore_count == 1
    assert config.extraction_strategy.__class__.__name__ == "JsonCssExtractionStrategy"
    assert "llm" not in config.extraction_strategy.__class__.__name__.lower()
    assert observed == {**observed, "entered": True, "closed": True}
    assert result.error_code is None
    assert result.jobs[0].title == "Senior AI Engineer"
    assert result.jobs[0].apply_url == "https://careers.acme.test/jobs/ai-42"
    assert result.jobs[0].provider_job_id


def test_custom_html_normalizes_every_page_from_crawl_result_container():
    class CrawlResultContainer:
        def __init__(self, pages):
            self._pages = pages

        def __iter__(self):
            return iter(self._pages)

        def __getattr__(self, name):
            return getattr(self._pages[0], name)

    class FakeCrawler:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def arun(self, **_kwargs):
            return CrawlResultContainer(
                [
                    SimpleNamespace(
                        success=True,
                        url="https://careers.acme.test/jobs",
                        extracted_content='[{"title":"AI Engineer","href":"/jobs/ai"}]',
                    ),
                    SimpleNamespace(
                        success=True,
                        url="https://careers.acme.test/jobs?page=2",
                        extracted_content=(
                            '[{"title":"Platform Engineer",'
                            '"href":"/jobs/platform"}]'
                        ),
                    ),
                ]
            )

    result = asyncio.run(
        CareerProvider(crawler_factory=lambda: FakeCrawler()).fetch(
            [target("custom", "acme-custom")]
        )
    )

    assert {job.title for job in result.jobs} == {"AI Engineer", "Platform Engineer"}


def test_shared_source_is_fetched_once_and_merges_sponsor_names():
    calls = []

    class FakeClient:
        async def fetch(self, targets):
            calls.append(targets)
            return FetchResult(
                source_key=targets[0].source_key,
                jobs=(),
                elapsed_ms=1,
                attempt_count=1,
                error_code="no_open_jobs",
            )

    targets = [
        target(sponsor_name="Acme LLC"),
        target(rank=2, sponsor_name="Acme Services"),
    ]
    results = asyncio.run(collect_sources(targets, client=FakeClient()))

    assert len(calls) == 1
    assert [item.sponsor_name for item in calls[0]] == ["Acme LLC", "Acme Services"]
    assert len(results) == 1


class HttpFailure(Exception):
    def __init__(self, status_code):
        super().__init__(f"HTTP {status_code}")
        self.status_code = status_code


@pytest.mark.parametrize("status", [408, 425, 429, 500, 502, 503, 504])
def test_only_allowed_http_statuses_are_retried_three_total_attempts(status):
    attempts = 0
    delays = []

    class FlakyClient:
        async def fetch(self, targets):
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise HttpFailure(status)
            return FetchResult(targets[0].source_key, (), 1, 1, "no_open_jobs")

    async def zero_delay(delay):
        delays.append(delay)

    results = asyncio.run(
        collect_sources(
            [target()],
            client=FlakyClient(),
            sleep=zero_delay,
            jitter=lambda: 0.0,
        )
    )

    assert attempts == 3
    assert delays == [1.0, 3.0]
    assert results[0].attempt_count == 3
    assert results[0].error_code == "no_open_jobs"


def test_ats_library_retry_hook_is_replaced_by_exact_outer_attempt_policy():
    actual_requests = 0
    hidden_fetchers_created = 0
    delays = []

    class Response:
        def __init__(self):
            self.status_code = 429
            self.headers = {}
            self.text = "rate limited"

        def json(self):
            return {}

    class RawClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def request(self, _method, _url, **_kwargs):
            nonlocal actual_requests
            actual_requests += 1
            return Response()

        async def aclose(self):
            return None

    class ScraperWithHiddenRetries:
        def make_fetcher(self):
            nonlocal hidden_fetchers_created
            hidden_fetchers_created += 1
            raise AssertionError("third-party retrying fetcher must be replaced")

        async def afetch(self):
            async with self.make_fetcher() as fetch:
                await fetch.get_json("https://api.acme.test/jobs")
            return []

    async def zero_delay(delay):
        delays.append(delay)

    provider = CareerProvider(
        scraper_factory=lambda *_args, **_kwargs: ScraperWithHiddenRetries(),
        http_client_factory=lambda **_kwargs: RawClient(),
    )
    result = asyncio.run(
        collect_sources(
            [target(career_url="https://api.acme.test/jobs")],
            client=provider,
            sleep=zero_delay,
            jitter=lambda: 0.0,
        )
    )[0]

    assert actual_requests == 3
    assert hidden_fetchers_created == 0
    assert delays == [1.0, 3.0]
    assert result.attempt_count == 3
    assert result.error_code == "http_429"


def test_fanned_out_provider_requests_obey_shared_global_and_host_limits():
    active = 0
    peak_global = 0
    active_hosts = defaultdict(int)
    peak_hosts = defaultdict(int)
    key_hosts = {
        "one-a": "one.test",
        "one-b": "one.test",
        "two-a": "two.test",
        "two-b": "two.test",
        "three-a": "three.test",
        "three-b": "three.test",
    }

    class Response:
        def __init__(self):
            self.status_code = 200
            self.headers = {}
            self.text = "{}"

        def json(self):
            return {}

    class RawClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def request(self, _method, url, **_kwargs):
            nonlocal active, peak_global
            host = urlparse(url).hostname
            active += 1
            active_hosts[host] += 1
            peak_global = max(peak_global, active)
            peak_hosts[host] = max(peak_hosts[host], active_hosts[host])
            await asyncio.sleep(0.01)
            active -= 1
            active_hosts[host] -= 1
            return Response()

        async def aclose(self):
            return None

    class FannedOutScraper:
        def __init__(self, host):
            self.host = host

        def make_fetcher(self):
            raise AssertionError("controlled fetcher was not installed")

        async def afetch(self):
            async with self.make_fetcher() as fetch:
                await asyncio.gather(
                    *(
                        fetch.get_json(f"https://{self.host}/jobs?page={page}")
                        for page in range(4)
                    )
                )
            return []

    provider = CareerProvider(
        scraper_factory=lambda _provider, key, **_kwargs: FannedOutScraper(
            key_hosts[key]
        ),
        http_client_factory=lambda **_kwargs: RawClient(),
    )
    sources = [
        target(
            provider_key=key,
            rank=index + 1,
            career_url=f"https://{host}/careers/{key}",
        )
        for index, (key, host) in enumerate(key_hosts.items())
    ]

    asyncio.run(
        collect_sources(sources, client=provider, concurrency=6, per_host=2)
    )

    assert peak_global == 6
    assert peak_hosts == {"one.test": 2, "two.test": 2, "three.test": 2}


def test_direct_sources_finish_before_custom_sources_start_even_if_custom_is_first():
    direct_active = 0
    custom_observed_active = None

    class OrderedClient:
        async def fetch(self, targets):
            nonlocal direct_active, custom_observed_active
            if targets[0].provider == "custom":
                custom_observed_active = direct_active
            else:
                direct_active += 1
                await asyncio.sleep(0.01)
                direct_active -= 1
            return FetchResult(targets[0].source_key, (), 1, 1, "no_open_jobs")

    sources = [
        target("custom", "custom-first"),
        target("greenhouse", "direct-a", rank=2),
        target("lever", "direct-b", rank=3),
    ]

    results = asyncio.run(collect_sources(sources, client=OrderedClient(), concurrency=3))

    assert custom_observed_active == 0
    assert [result.source_key for result in results] == [
        "greenhouse:direct-a",
        "lever:direct-b",
        "custom:custom-first",
    ]


def test_one_failed_source_does_not_cancel_successful_source():
    class FakeProviderClient:
        async def fetch(self, targets):
            source = targets[0]
            if source.provider_key == "bad":
                raise HttpFailure(503)
            job = ats_job("greenhouse", "ok-1", "https://jobs.example.test/ok-1")
            normalized = CareerProvider.normalize_jobs(targets, [job])
            return FetchResult(source.source_key, normalized, 1, 1, None)

    async def zero_delay(_delay):
        return None

    fake_targets = [
        target("greenhouse", "ok"),
        target(
            "workday",
            "bad",
            rank=2,
            career_url="https://bad.wd1.myworkdayjobs.com/jobs",
        ),
    ]
    results = asyncio.run(
        collect_sources(
            fake_targets,
            client=FakeProviderClient(),
            concurrency=2,
            sleep=zero_delay,
            jitter=lambda: 0.0,
        )
    )

    assert {result.source_key for result in results} == {
        "greenhouse:ok",
        "workday:bad",
    }
    assert next(r for r in results if r.source_key == "greenhouse:ok").jobs
    failed = next(r for r in results if r.source_key == "workday:bad")
    assert failed.error_code == "http_503"
    assert failed.attempt_count == 3


@pytest.mark.parametrize("status", [401, 403, 404])
def test_non_retryable_http_statuses_are_not_retried(status):
    attempts = 0

    class Client:
        async def fetch(self, _targets):
            nonlocal attempts
            attempts += 1
            raise HttpFailure(status)

    result = asyncio.run(collect_sources([target()], client=Client()))[0]

    assert attempts == 1
    assert result.error_code == f"http_{status}"


@pytest.mark.parametrize("message", ["company not found", "provider key missing"])
def test_common_missing_provider_errors_are_structured_as_http_404(message):
    class Client:
        async def fetch(self, _targets):
            raise RuntimeError(message)

    result = asyncio.run(collect_sources([target()], client=Client()))[0]

    assert result.attempt_count == 1
    assert result.error_code == "http_404"


def test_unverified_targets_are_rejected_without_fetching():
    class Client:
        async def fetch(self, _targets):
            raise AssertionError("must not fetch an unverified registry target")

    unverified = SponsorTarget(
        rank=1,
        sponsor_name="Acme",
        canonical_company="Acme",
        total_approvals=10,
        career_url=None,
        provider=None,
        provider_key=None,
        mapping_status="unsupported",
        validation_notes="reviewed unsupported source",
    )

    assert asyncio.run(collect_sources([unverified], client=Client())) == []
