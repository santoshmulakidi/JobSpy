from datetime import timedelta

from api.main import _scheduler_status_with_recent_runs
from collectors import CollectionRequest
from collectors.base import now_utc
from scheduler.hourly import HourlyRefreshScheduler
from storage.models import SearchRun
from tests.test_repository import make_session


def test_scheduler_status_infers_running_from_recent_scheduler_run():
    session = make_session()
    run = SearchRun(
        search_term="developer",
        location="United States",
        sites=["linkedin"],
        results_wanted=100,
        started_at=now_utc() - timedelta(minutes=15),
        finished_at=now_utc() - timedelta(minutes=14),
        jobs_seen=42,
        errors=[],
        metadata_json={"scheduler": "hourly"},
    )
    session.add(run)
    session.commit()

    status = _scheduler_status_with_recent_runs(
        session,
        {
            "running": False,
            "interval_hours": 1,
            "next_run_at": None,
            "last_run_at": None,
            "last_search_run_id": None,
            "last_jobs_seen": None,
            "last_error_count": 0,
            "last_errors": [],
        },
    )

    assert status["running"] is True
    assert status["last_search_run_id"] == run.id
    assert status["last_jobs_seen"] == 42


def test_hourly_scheduler_tags_collection_runs_as_hourly(monkeypatch):
    scheduler = HourlyRefreshScheduler()

    class FakeBackgroundScheduler:
        running = False

        def __init__(self, timezone):
            self.timezone = timezone

        def add_job(self, *args, **kwargs):
            return None

        def start(self):
            self.running = True

        def get_job(self, job_id):
            return None

        def shutdown(self, wait=False):
            self.running = False

    monkeypatch.setattr("scheduler.hourly.BackgroundScheduler", FakeBackgroundScheduler)

    scheduler.start(CollectionRequest(search_term="developer", sites=["linkedin"], metadata={"source": "test"}))
    try:
        assert scheduler._request.metadata == {"source": "test", "scheduler": "hourly"}
    finally:
        scheduler.stop()
