import sqlite3
from datetime import UTC, datetime

import pytest

from career_alerts.emailer import EmailJob, render_email
from career_alerts.providers import FetchResult
from career_alerts.state import CareerAlertState
from career_alerts.types import CareerJob, MatchedJob
from career_alerts.windows import DeliveryWindow


def dt(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(UTC)


def matched(
    *streams: str,
    provider_job_id: str = "123",
    source_key: str = "greenhouse:acme",
    apply_url: str = "https://acme.test/jobs/123?source=board#details",
) -> MatchedJob:
    job = CareerJob(
        source_key=source_key,
        provider="greenhouse",
        provider_job_id=provider_job_id,
        company="Acme",
        sponsor_names=("Acme LLC",),
        title="Senior .NET Developer",
        location="Dallas, TX",
        description="Build APIs",
        apply_url=apply_url,
        posted_at=None,
        is_remote=False,
    )
    return MatchedJob(job=job, streams=frozenset(streams), location_bucket="DFW Metro")


@pytest.fixture
def matched_dotnet():
    return matched("dotnet")


def test_identical_provider_id_is_not_requeued(tmp_path, matched_dotnet):
    state = CareerAlertState(tmp_path / "state.sqlite3")
    state.upsert_matches([matched_dotnet], observed_at=dt("2026-08-12T10:00:00Z"))
    state.record_delivery("dotnet", [state.pending("dotnet")[0][0]], dt("2026-08-12T11:00:00Z"))
    state.upsert_matches([matched_dotnet], observed_at=dt("2026-08-12T12:00:00Z"))

    assert state.pending("dotnet") == []


def test_same_job_queues_independently_in_both_streams(tmp_path):
    state = CareerAlertState(tmp_path / "state.sqlite3")
    state.upsert_matches([matched("dotnet", "ai_engineer")], dt("2026-08-12T10:00:00Z"))

    assert len(state.pending("dotnet")) == 1
    assert len(state.pending("ai_engineer")) == 1


def test_failed_delivery_preserves_pending_jobs(tmp_path, matched_dotnet):
    state = CareerAlertState(tmp_path / "state.sqlite3")
    state.upsert_matches([matched_dotnet], observed_at=dt("2026-08-12T10:00:00Z"))
    before = state.pending("dotnet")
    state.record_delivery("dotnet", [], delivered_at=dt("2026-08-12T13:00:00Z"), success=False)

    assert state.pending("dotnet") == before


def test_successful_delivery_clears_only_its_stream(tmp_path):
    state = CareerAlertState(tmp_path / "state.sqlite3")
    state.upsert_matches([matched("dotnet", "ai_engineer")], dt("2026-08-12T10:00:00Z"))
    dotnet_key = state.pending("dotnet")[0][0]

    state.record_delivery("dotnet", [dotnet_key], dt("2026-08-12T11:00:00Z"))

    assert state.pending("dotnet") == []
    assert len(state.pending("ai_engineer")) == 1


def test_three_consecutive_source_failures_mark_source_degraded(tmp_path):
    state = CareerAlertState(tmp_path / "state.sqlite3")
    failure = FetchResult("greenhouse:acme", (), 100, 1, "http_500")
    for hour in range(3):
        state.record_source_result(failure, dt(f"2026-08-12T{hour:02d}:00:00Z"))

    assert state.status()["sources"]["greenhouse:acme"]["degraded"] is True
    assert state.status()["sources"]["greenhouse:acme"]["consecutive_failures"] == 3


def test_successful_source_run_resets_failure_count(tmp_path):
    state = CareerAlertState(tmp_path / "state.sqlite3")
    failure = FetchResult("greenhouse:acme", (), 100, 1, "http_500")
    for hour in range(3):
        state.record_source_result(failure, dt(f"2026-08-12T{hour:02d}:00:00Z"))

    state.record_source_result(
        FetchResult("greenhouse:acme", (), 100, 1, None), dt("2026-08-12T03:00:00Z")
    )

    assert state.status()["sources"]["greenhouse:acme"] == {
        "consecutive_failures": 0,
        "degraded": False,
        "last_error_code": None,
    }


def test_missed_scheduled_run_keeps_all_unsent_jobs_pending(tmp_path):
    state = CareerAlertState(tmp_path / "state.sqlite3")
    state.upsert_matches(
        [matched("dotnet", provider_job_id="one"), matched("dotnet", provider_job_id="two")],
        dt("2026-08-12T10:00:00Z"),
    )

    assert len(state.pending("dotnet")) == 2


def test_pending_exposes_immutable_first_seen_timestamp(tmp_path, matched_dotnet):
    state = CareerAlertState(tmp_path / "state.sqlite3")
    first = dt("2026-08-12T10:00:00Z")
    state.upsert_matches([matched_dotnet], first)
    state.upsert_matches([matched_dotnet], dt("2026-08-12T12:00:00Z"))

    assert state.pending("dotnet")[0][2] == first


def test_http_to_same_host_https_reconciles_to_one_pending_job(tmp_path):
    state = CareerAlertState(tmp_path / "state.sqlite3")
    old = matched(
        "ai_engineer",
        provider_job_id="block-1",
        source_key="greenhouse:block",
        apply_url="http://block.xyz/careers/jobs/block-1?gh_jid=block-1",
    )
    current = matched(
        "ai_engineer",
        provider_job_id="block-1",
        source_key="greenhouse:block",
        apply_url="https://block.xyz/careers/jobs/block-1?gh_jid=block-1",
    )
    state.upsert_matches([old], dt("2026-08-12T10:00:00Z"))

    state.upsert_matches([current], dt("2026-08-12T12:00:00Z"))

    pending = state.pending("ai_engineer")
    assert len(pending) == 1
    assert pending[0][1].job.apply_url == (
        "https://block.xyz/careers/jobs/block-1?gh_jid=block-1"
    )
    assert pending[0][2] == dt("2026-08-12T10:00:00Z")
    window_time = dt("2026-08-12T12:00:00Z")
    messages = render_email(
        "ai_engineer",
        DeliveryWindow(window_time, window_time, "Initial activation", "regular"),
        [EmailJob(pending[0][1], pending[0][2])],
    )
    assert len(messages) == 1


def test_delivered_http_job_migrates_history_and_stays_delivered(tmp_path):
    state = CareerAlertState(tmp_path / "state.sqlite3")
    old = matched(
        "ai_engineer",
        provider_job_id="block-2",
        source_key="greenhouse:block",
        apply_url="http://block.xyz/careers/jobs/block-2",
    )
    current = matched(
        "ai_engineer",
        provider_job_id="block-2",
        source_key="greenhouse:block",
        apply_url="https://block.xyz/careers/jobs/block-2",
    )
    state.upsert_matches([old], dt("2026-08-12T10:00:00Z"))
    old_key = state.pending("ai_engineer")[0][0]
    state.record_delivery(
        "ai_engineer", [old_key], dt("2026-08-12T11:00:00Z"), success=True
    )

    state.upsert_matches([current], dt("2026-08-12T12:00:00Z"))

    assert state.pending("ai_engineer") == []
    with sqlite3.connect(state.path) as connection:
        migrated_key = connection.execute(
            "SELECT job_key FROM jobs WHERE apply_url LIKE 'https://block.xyz/%'"
        ).fetchone()[0]
        assert connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 1
        assert connection.execute(
            "SELECT job_key FROM delivery_jobs"
        ).fetchone()[0] == migrated_key


def test_http_job_is_not_reconciled_to_different_https_host(tmp_path):
    state = CareerAlertState(tmp_path / "state.sqlite3")
    old = matched(
        "ai_engineer",
        provider_job_id="block-3",
        source_key="greenhouse:block",
        apply_url="http://redirect.example.test/careers/jobs/block-3",
    )
    current = matched(
        "ai_engineer",
        provider_job_id="block-3",
        source_key="greenhouse:block",
        apply_url="https://block.xyz/careers/jobs/block-3",
    )
    state.upsert_matches([old], dt("2026-08-12T10:00:00Z"))

    state.upsert_matches([current], dt("2026-08-12T12:00:00Z"))

    assert {row[1].job.apply_url for row in state.pending("ai_engineer")} == {
        "http://redirect.example.test/careers/jobs/block-3",
        "https://block.xyz/careers/jobs/block-3",
    }


def test_http_job_is_not_reconciled_when_raw_query_differs(tmp_path):
    state = CareerAlertState(tmp_path / "state.sqlite3")
    old = matched(
        "ai_engineer",
        provider_job_id="block-query",
        source_key="greenhouse:block",
        apply_url="http://block.xyz/careers/jobs/view?id=1&locale=en",
    )
    current = matched(
        "ai_engineer",
        provider_job_id="block-query",
        source_key="greenhouse:block",
        apply_url="https://block.xyz/careers/jobs/view?id=2&locale=en",
    )
    state.upsert_matches([old], dt("2026-08-12T10:00:00Z"))

    state.upsert_matches([current], dt("2026-08-12T12:00:00Z"))

    assert {row[1].job.apply_url for row in state.pending("ai_engineer")} == {
        "http://block.xyz/careers/jobs/view?id=1&locale=en",
        "https://block.xyz/careers/jobs/view?id=2&locale=en",
    }
