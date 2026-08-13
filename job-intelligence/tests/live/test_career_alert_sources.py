import asyncio
import os
from pathlib import Path
from urllib.parse import urlparse

import pytest

from career_alerts.providers import collect_sources
from career_alerts.registry import load_registry

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        os.getenv("CAREER_ALERTS_LIVE") != "1",
        reason="set CAREER_ALERTS_LIVE=1 to run representative source checks",
    ),
]

REGISTRY_PATH = Path(__file__).resolve().parents[2] / "data" / "top250_career_targets.json"


def _reviewed_target(providers):
    target = next(
        (
            item
            for item in load_registry(REGISTRY_PATH)
            if item.mapping_status == "verified" and item.provider in providers
        ),
        None,
    )
    if target is None:
        pytest.skip(f"registry has no reviewed {'/'.join(providers)} source")
    return target


@pytest.mark.parametrize(
    ("source_kind", "providers"),
    [
        ("workday", ("workday",)),
        ("greenhouse", ("greenhouse",)),
        ("lever", ("lever",)),
        ("oracle_or_icims", ("oracle", "icims")),
        ("custom_crawl4ai", ("custom",)),
    ],
)
def test_representative_reviewed_source(source_kind, providers):
    target = _reviewed_target(providers)

    result = asyncio.run(
        collect_sources([target], concurrency=1, per_host=1)
    )[0]

    assert result.source_key == target.source_key, source_kind
    assert result.error_code in {None, "no_open_jobs"}, result.error_code
    assert result.jobs or result.error_code == "no_open_jobs"
    for job in result.jobs:
        parsed = urlparse(job.apply_url)
        assert parsed.scheme == "https" and parsed.netloc
