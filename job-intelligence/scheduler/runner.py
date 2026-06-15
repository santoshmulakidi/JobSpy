from __future__ import annotations

import logging

from apscheduler.schedulers.blocking import BlockingScheduler

from api.services import CollectionService
from collectors import CollectionRequest
from notifications.dispatcher import NotificationDispatcher
from storage.config import get_settings
from storage.database import SessionLocal, init_database
from storage.repository import JobRepository


logger = logging.getLogger(__name__)

# Fallback search used when no saved searches exist in the DB.
_DEFAULT_SEARCH = CollectionRequest(
    search_term="Senior .NET Developer",
    location="Texas",
    results_wanted=100,
    hours_old=1,
)


def _build_requests(settings) -> list[CollectionRequest]:
    """Return one CollectionRequest per saved search, falling back to the default."""
    session = SessionLocal()
    try:
        saved = JobRepository(session).list_saved_searches()
        if not saved:
            logger.info("no saved searches found, using default search")
            return [_DEFAULT_SEARCH]

        requests: list[CollectionRequest] = []
        for ss in saved:
            f = ss.filters or {}
            # saved search filters use SearchRequest shape (keyword/company/location)
            # map to CollectionRequest for scraping
            search_term = f.get("keyword") or f.get("search_term") or "Software Developer"
            req = CollectionRequest(
                search_term=search_term,
                location=f.get("location"),
                sites=settings.default_site_list,
                results_wanted=100,
                hours_old=1,
            )
            requests.append(req)
            logger.info(
                "scheduled search name=%r keyword=%r location=%r",
                ss.name,
                search_term,
                f.get("location"),
            )
        return requests
    finally:
        session.close()


def run_collection() -> None:
    settings = get_settings()
    requests = _build_requests(settings)
    dispatcher = NotificationDispatcher.from_settings(settings)

    for req in requests:
        session = SessionLocal()
        try:
            run, result = CollectionService(session).collect(req)
            dispatcher.send(
                f"Job Intelligence run {run.id} ({req.search_term} / {req.location or 'any'}): "
                f"collected {result.count} jobs with {len(result.errors)} errors."
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
