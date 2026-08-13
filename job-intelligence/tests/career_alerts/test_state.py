from datetime import UTC, datetime

import pytest

from career_alerts.providers import FetchResult
from career_alerts.state import CareerAlertState
from career_alerts.types import CareerJob, MatchedJob


def dt(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(UTC)


def matched(*streams: str, provider_job_id: str = "123") -> MatchedJob:
    job = CareerJob(
        source_key="greenhouse:acme",
        provider="greenhouse",
        provider_job_id=provider_job_id,
        company="Acme",
        sponsor_names=("Acme LLC",),
        title="Senior .NET Developer",
        location="Dallas, TX",
        description="Build APIs",
        apply_url="https://acme.test/jobs/123?source=board#details",
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
