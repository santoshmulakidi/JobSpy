from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from career_alerts.providers import FetchResult
from career_alerts.runner import CareerAlertRunner
from career_alerts.state import CareerAlertState
from career_alerts.types import CareerJob, MatchedJob, SponsorTarget


def target() -> SponsorTarget:
    return SponsorTarget(
        1, "Acme", "Acme", 1, "https://jobs.acme.test", "greenhouse", "acme",
        "verified", "reviewed source",
    )


def match(*streams: str) -> MatchedJob:
    return MatchedJob(
        CareerJob(
            "greenhouse:acme", "greenhouse", "1", "Acme", ("Acme",),
            "Senior .NET Developer", "Dallas, TX", "", "https://jobs.acme.test/1",
            None, False,
        ),
        frozenset(streams),
        "DFW Metro",
    )


class FakeMailer:
    def __init__(self, fail_stream=None):
        self.messages = []
        self.fail_stream = fail_stream

    def send(self, message):
        if message.stream == self.fail_stream:
            raise RuntimeError("smtp unavailable")
        self.messages.append(message)


@pytest.fixture
def runner(tmp_path):
    return make_runner(tmp_path, [FetchResult("greenhouse:acme", (match("dotnet", "ai_engineer").job,), 1, 1, None)])


@pytest.fixture
def fake_mailer(runner):
    return runner.mailer


def make_runner(tmp_path, results, *, mailer=None):
    async def collect(_targets):
        return results

    return CareerAlertRunner(
        registry_loader=lambda _path: [target()],
        registry_validator=lambda _targets: [],
        collector=collect,
        state=CareerAlertState(tmp_path / "state.sqlite3"),
        matcher=lambda job: match("dotnet", "ai_engineer"),
        mailer=mailer or FakeMailer(),
        renderer=lambda stream, _window, jobs: [SimpleNamespace(stream=stream, jobs=jobs)],
        clock=lambda: datetime(2026, 8, 12, 18, tzinfo=UTC),
    )


def test_no_email_dry_run_sends_nothing(runner, fake_mailer):
    summary = runner.collect(send_email=False, initial=False)

    assert fake_mailer.messages == []
    assert summary.delivery_counts == {}


def test_initial_mode_sends_every_active_match_in_each_stream(runner, fake_mailer):
    summary = runner.collect(send_email=True, initial=True)

    assert [message.stream for message in fake_mailer.messages] == ["dotnet", "ai_engineer"]
    assert summary.delivery_counts == {"dotnet": 1, "ai_engineer": 1}


def test_scheduled_mode_sends_only_pending_jobs(runner, fake_mailer):
    runner.collect(send_email=True, initial=False)
    summary = runner.collect(send_email=True, initial=False)

    assert len(fake_mailer.messages) == 2
    assert summary.delivery_counts == {}


def test_one_source_failure_delivers_successful_results_and_is_degraded(tmp_path):
    successful = FetchResult("greenhouse:acme", (match("dotnet").job,), 1, 1, None)
    failure = FetchResult("lever:beta", (), 1, 1, "http_500")
    runner = make_runner(tmp_path, [successful, failure])

    summary = runner.collect(send_email=True, initial=False)

    assert summary.degraded_sources == 1
    assert runner.mailer.messages[0].stream == "dotnet"


def test_mail_failure_does_not_advance_stream(tmp_path):
    mailer = FakeMailer(fail_stream="dotnet")
    runner = make_runner(tmp_path, [FetchResult("greenhouse:acme", (match("dotnet").job,), 1, 1, None)], mailer=mailer)

    summary = runner.collect(send_email=True, initial=False)

    assert summary.delivery_failed is True
    assert len(runner.state.pending("dotnet")) == 1


def test_streams_are_delivered_separately(runner, fake_mailer):
    summary = runner.collect(send_email=True, initial=False)
    assert [message.stream for message in fake_mailer.messages] == ["dotnet", "ai_engineer"]
    assert summary.delivery_counts == {"dotnet": 1, "ai_engineer": 1}
