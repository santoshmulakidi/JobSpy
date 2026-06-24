from __future__ import annotations

import logging
from datetime import datetime
from threading import Lock

from apscheduler.schedulers.background import BackgroundScheduler

from api.services import CollectionService
from collectors import CollectionRequest
from collectors.base import now_utc
from collectors.company_targets import load_h1b_company_targets
from storage.database import SessionLocal, init_database


logger = logging.getLogger(__name__)

H1B_COMPANY_INTERVAL_HOURS = 2.5
H1B_COMPANY_SOURCES = ["linkedin", "indeed", "google", "dice"]
H1B_COMPANY_SEARCH_TERM = '(".NET" OR "Dotnet" OR "C#")'
H1B_COMPANY_SCHEDULER = "h1b_company_schedule"


def build_h1b_company_request() -> CollectionRequest:
    target_count = len(load_h1b_company_targets())
    return CollectionRequest(
        search_term=H1B_COMPANY_SEARCH_TERM,
        location="United States",
        sites=H1B_COMPANY_SOURCES,
        results_wanted=5000,
        hours_old=3,
        use_company_targets=True,
        company_target_limit=target_count,
        skip_expand=True,
        metadata={
            "scheduler": H1B_COMPANY_SCHEDULER,
            "company_target_set": "h1b",
            "target_count": target_count,
        },
    )


class H1BCompanyScheduler:
    def __init__(self) -> None:
        self._lock = Lock()
        self._scheduler: BackgroundScheduler | None = None
        self._last_run_at: datetime | None = None
        self._last_search_run_id: int | None = None
        self._last_jobs_seen: int | None = None
        self._last_errors: list[str] = []

    def start(self) -> dict:
        with self._lock:
            if self._scheduler and self._scheduler.running:
                self._scheduler.remove_all_jobs()
            else:
                self._scheduler = BackgroundScheduler(timezone="America/Chicago")

            self._scheduler.add_job(
                self._run_once,
                "interval",
                hours=H1B_COMPANY_INTERVAL_HOURS,
                id=H1B_COMPANY_SCHEDULER,
                next_run_time=now_utc(),
                replace_existing=True,
                max_instances=1,
                coalesce=True,
            )
            if not self._scheduler.running:
                self._scheduler.start()
        return self.status()

    def stop(self) -> dict:
        with self._lock:
            if self._scheduler and self._scheduler.running:
                self._scheduler.shutdown(wait=False)
            self._scheduler = None
        return self.status()

    def status(self) -> dict:
        running = bool(self._scheduler and self._scheduler.running)
        next_run_at = None
        if running and self._scheduler:
            job = self._scheduler.get_job(H1B_COMPANY_SCHEDULER)
            next_run_at = job.next_run_time if job else None
        return {
            "running": running,
            "interval_hours": H1B_COMPANY_INTERVAL_HOURS,
            "next_run_at": next_run_at,
            "last_run_at": self._last_run_at,
            "last_search_run_id": self._last_search_run_id,
            "last_jobs_seen": self._last_jobs_seen,
            "last_error_count": len(self._last_errors),
            "last_errors": self._last_errors,
            "target_count": len(load_h1b_company_targets()),
            "sources": H1B_COMPANY_SOURCES,
        }

    def trigger(self) -> dict:
        self._run_once()
        return self.status()

    def _run_once(self) -> None:
        init_database()
        session = SessionLocal()
        try:
            run, result = CollectionService(session).collect(build_h1b_company_request())
            self._last_run_at = now_utc()
            self._last_search_run_id = run.id
            self._last_jobs_seen = result.count
            self._last_errors = result.errors
            logger.info(
                "h1b company schedule completed run_id=%s jobs=%s errors=%s",
                run.id,
                result.count,
                len(result.errors),
            )
        except Exception as exc:  # pragma: no cover - defensive background logging
            logger.exception("h1b company schedule failed")
            self._last_run_at = now_utc()
            self._last_search_run_id = None
            self._last_jobs_seen = 0
            self._last_errors = [str(exc)]
        finally:
            session.close()


h1b_company_scheduler = H1BCompanyScheduler()
