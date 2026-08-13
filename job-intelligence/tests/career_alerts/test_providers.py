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


def test_http_429_is_retried_with_injected_zero_delay_sleep():
    attempts = 0
    delays = []

    class FlakyClient:
        async def fetch(self, targets):
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise HttpFailure(429)
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


def test_global_and_per_host_concurrency_are_bounded():
    active = 0
    peak_global = 0
    active_hosts = defaultdict(int)
    peak_hosts = defaultdict(int)

    class MeasuringClient:
        async def fetch(self, targets):
            nonlocal active, peak_global
            host = urlparse(targets[0].career_url).hostname
            active += 1
            active_hosts[host] += 1
            peak_global = max(peak_global, active)
            peak_hosts[host] = max(peak_hosts[host], active_hosts[host])
            await asyncio.sleep(0.01)
            active -= 1
            active_hosts[host] -= 1
            return FetchResult(targets[0].source_key, (), 1, 1, "no_open_jobs")

    targets = [
        target(
            provider_key=f"source-{index}",
            rank=index + 1,
            career_url=f"https://{host}/jobs/{index}",
        )
        for index, host in enumerate(
            ["one.test", "one.test", "one.test", "two.test", "two.test", "three.test"]
        )
    ]

    asyncio.run(
        collect_sources(targets, client=MeasuringClient(), concurrency=3, per_host=2)
    )

    assert peak_global == 3
    assert peak_hosts["one.test"] == 2
    assert all(peak <= 2 for peak in peak_hosts.values())


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
