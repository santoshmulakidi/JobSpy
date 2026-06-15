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

# All 12 target role keywords.
_KEYWORDS = [
    "Senior .NET Developer",
    "Senior Full Stack .NET Developer",
    "Senior C# Developer",
    "Senior Azure Developer",
    "Senior Software Engineer .NET",
    ".NET Cloud Developer",
    "Senior ASP.NET Core Developer",
    "Senior Backend Developer C#",
    ".NET Solutions Architect",
    "Azure Application Architect",
    "Principal .NET Developer",
    "Lead .NET Developer",
]

# Priority-ordered location tiers.
# (label, location, is_remote, visa_friendly)
_TIERS: list[tuple[str, str, bool, bool]] = [
    ("Remote+Visa",     "United States",  True,  True),
    ("DFW Hybrid+Visa", "Dallas, TX",     False, True),
    ("Texas",           "Texas",          False, False),
    ("North Carolina",  "North Carolina", False, False),
    # Nearby TX states
    ("Oklahoma",        "Oklahoma",       False, False),
    ("Louisiana",       "Louisiana",      False, False),
    ("Arkansas",        "Arkansas",       False, False),
    ("New Mexico",      "New Mexico",     False, False),
    # Nearby NC states
    ("Virginia",        "Virginia",       False, False),
    ("South Carolina",  "South Carolina", False, False),
    ("Georgia",         "Georgia",        False, False),
    ("Tennessee",       "Tennessee",      False, False),
    # Nationwide fallback
    ("USA",             "United States",  False, False),
]


def _build_requests(settings) -> list[CollectionRequest]:
    """One request per saved-search, or keyword × tier matrix if none exist."""
    session = SessionLocal()
    try:
        saved = JobRepository(session).list_saved_searches()
    finally:
        session.close()

    if saved:
        requests: list[CollectionRequest] = []
        for ss in saved:
            f = ss.filters or {}
            search_term = f.get("keyword") or f.get("search_term") or "Software Developer"
            req = CollectionRequest(
                search_term=search_term,
                location=f.get("location"),
                sites=settings.default_site_list,
                hours_old=1,
            )
            requests.append(req)
            logger.info("saved-search name=%r keyword=%r location=%r", ss.name, search_term, f.get("location"))
        return requests

    # No saved searches — run full keyword × tier matrix.
    logger.info("no saved searches, running %d keywords × %d tiers", len(_KEYWORDS), len(_TIERS))
    requests = []
    for keyword in _KEYWORDS:
        for label, location, is_remote, visa_friendly in _TIERS:
            requests.append(CollectionRequest(
                search_term=keyword,
                location=location,
                sites=settings.default_site_list,
                is_remote=is_remote,
                visa_friendly_only=visa_friendly,
                hours_old=1,
            ))
    return requests


def run_collection() -> None:
    settings = get_settings()
    requests = _build_requests(settings)
    dispatcher = NotificationDispatcher.from_settings(settings)

    total_collected = 0
    total_errors = 0
    for req in requests:
        session = SessionLocal()
        try:
            run, result = CollectionService(session).collect(req)
            total_collected += result.count
            total_errors += len(result.errors)
            if result.count:
                logger.info(
                    "collected keyword=%r location=%r remote=%s visa=%s count=%d",
                    req.search_term, req.location, req.is_remote, req.visa_friendly_only, result.count,
                )
        finally:
            session.close()

    dispatcher.send(
        f"Job Intelligence hourly run: {total_collected} jobs collected across "
        f"{len(requests)} searches with {total_errors} errors."
    )


def main() -> None:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    init_database()
    scheduler = BlockingScheduler()
    scheduler.add_job(run_collection, "interval", hours=settings.scheduler_hours, id="collect_jobs")
    logger.info("scheduler started interval_hours=%s searches_per_run=%d", settings.scheduler_hours, len(_KEYWORDS) * len(_TIERS))
    scheduler.start()


if __name__ == "__main__":
    main()
