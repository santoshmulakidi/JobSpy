from __future__ import annotations

import logging
from datetime import datetime
from threading import Lock

from apscheduler.schedulers.background import BackgroundScheduler

from api.services import CollectionService
from collectors import CollectionRequest
from collectors.base import now_utc
from storage.database import SessionLocal, init_database


logger = logging.getLogger(__name__)


class HourlyRefreshScheduler:
    def __init__(self) -> None:
        self._lock = Lock()
        self._scheduler: BackgroundScheduler | None = None
        self._request: CollectionRequest | None = None
        self._last_run_at: datetime | None = None
        self._last_search_run_id: int | None = None
        self._last_jobs_seen: int | None = None
        self._last_errors: list[str] = []

    def start(self, request: CollectionRequest) -> dict:
        scheduled_request = request.model_copy(
            update={
                "hours_old": request.hours_old or 1,
                "metadata": {**request.metadata, "scheduler": "hourly"},
            }
        )
        with self._lock:
            self._request = scheduled_request
            if self._scheduler and self._scheduler.running:
                self._scheduler.remove_all_jobs()
            else:
                self._scheduler = BackgroundScheduler(timezone="UTC")

            self._scheduler.add_job(
                self._run_once,
                "interval",
                hours=1,
                id="hourly_job_refresh",
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
        next_run_at = None
        running = bool(self._scheduler and self._scheduler.running)
        if running and self._scheduler:
            job = self._scheduler.get_job("hourly_job_refresh")
            next_run_at = job.next_run_time if job else None
        return {
            "running": running,
            "interval_hours": 1,
            "next_run_at": next_run_at,
            "last_run_at": self._last_run_at,
            "last_search_run_id": self._last_search_run_id,
            "last_jobs_seen": self._last_jobs_seen,
            "last_error_count": len(self._last_errors),
            "last_errors": self._last_errors,
        }

    def _run_once(self) -> None:
        request = self._request
        if request is None:
            return

        init_database()
        session = SessionLocal()
        try:
            run, result = CollectionService(session).collect(request)
            self._last_run_at = now_utc()
            self._last_search_run_id = run.id
            self._last_jobs_seen = result.count
            self._last_errors = result.errors
            logger.info(
                "hourly refresh completed run_id=%s jobs=%s errors=%s",
                run.id,
                result.count,
                len(result.errors),
            )
        except Exception as exc:  # pragma: no cover - defensive background logging
            logger.exception("hourly refresh failed")
            self._last_run_at = now_utc()
            self._last_search_run_id = None
            self._last_jobs_seen = 0
            self._last_errors = [str(exc)]
        finally:
            session.close()


hourly_refresh_scheduler = HourlyRefreshScheduler()
