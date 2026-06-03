from __future__ import annotations

import logging

from apscheduler.schedulers.blocking import BlockingScheduler

from api.services import CollectionService
from collectors import CollectionRequest
from notifications.dispatcher import NotificationDispatcher
from storage.config import get_settings
from storage.database import SessionLocal, init_database


logger = logging.getLogger(__name__)


def run_collection() -> None:
    settings = get_settings()
    session = SessionLocal()
    try:
        request = CollectionRequest(
            search_term="Senior .NET Developer",
            location="Texas",
            sites=settings.default_site_list,
            results_wanted=100,
        )
        run, result = CollectionService(session).collect(request)
        NotificationDispatcher.from_settings(settings).send(
            f"Job Intelligence run {run.id}: collected {result.count} jobs with {len(result.errors)} errors."
        )
    finally:
        session.close()


def main() -> None:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    init_database()
    scheduler = BlockingScheduler()
    scheduler.add_job(run_collection, "interval", hours=settings.scheduler_hours, id="collect_jobs")
    logger.info("scheduler started interval_hours=%s", settings.scheduler_hours)
    scheduler.start()


if __name__ == "__main__":
    main()
