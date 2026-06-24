from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime

from apscheduler.schedulers.blocking import BlockingScheduler

from api.services import CollectionService
from collectors import CollectionRequest
from notifications.dispatcher import NotificationDispatcher
from scheduler.h1b_company import H1B_COMPANY_INTERVAL_HOURS, build_h1b_company_request
from scraper.direct_jobs import scrape_direct_jobs
from storage.config import get_settings
from storage.database import SessionLocal, init_database
from storage.repository import JobRepository


logger = logging.getLogger(__name__)

# ── Sources ──────────────────────────────────────────────────────────────────
# Location-aware boards — search all tiers
# jobright_h1b removed — it ignores search keywords and returns all H1B sponsor jobs,
# flooding the DB with unrelated roles (Data Scientist, AI Engineer, PM, etc.)
_LOCATION_SITES = ["linkedin", "indeed", "career_page", "dice"]

# Remote-only boards — only make sense for the Remote tier
_REMOTE_SITES = ["jobspresso", "dynamitejobs", "skipthedrive", "remotive", "remotely", "yc_jobs"]

# ── Keywords ─────────────────────────────────────────────────────────────────
_KEYWORDS = [
    ".NET Developer",
    "DotNet Developer",
    "C# Developer",
    "ASP.NET Core Developer",
    "Azure Developer .NET",
    "Principal .NET Engineer",
    "Staff Software Engineer C#",
]

# ── Tiers ─────────────────────────────────────────────────────────────────────
# Single USA-wide search per keyword. Location filtering (Remote+Visa, DFW,
# Texas, NC) is handled in the UI — no need to duplicate searches per region.
_TIERS: list[tuple[str, str, bool, bool, bool]] = [
    ("USA", "United States", False, False, True),
]

# 2 workers avoids Google/LinkedIn 429s from too many simultaneous requests.
# 4 workers triggered rate-limiting that actually made runs slower (retries + backoff).
_MAX_WORKERS = 2


def _build_requests(settings) -> list[CollectionRequest]:
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
                sites=_LOCATION_SITES + _REMOTE_SITES,
                hours_old=24,
                skip_expand=True,
            )
            requests.append(req)
            logger.info("saved-search name=%r keyword=%r location=%r", ss.name, search_term, f.get("location"))
        return requests

    requests = []

    # Location boards: run every keyword against USA
    for keyword in _KEYWORDS:
        requests.append(CollectionRequest(
            search_term=keyword,
            location="United States",
            sites=_LOCATION_SITES,
            hours_old=24,
            skip_expand=True,
        ))

    # Remote-only boards: run once per keyword (they ignore location anyway,
    # so one broad sweep per keyword is enough — avoids 9× duplicate fetches)
    for keyword in [".NET Developer", "C# Developer", "DotNet Developer"]:
        requests.append(CollectionRequest(
            search_term=keyword,
            location="United States",
            sites=_REMOTE_SITES,
            is_remote=True,
            hours_old=24,
            skip_expand=True,
        ))

    logger.info(
        "built %d requests (%d location + %d remote-board) — running %d at a time",
        len(requests), len(_KEYWORDS), 3, _MAX_WORKERS,
    )
    return requests


def _run_one(req: CollectionRequest) -> tuple[int, int]:
    """Run a single collection request. Returns (jobs_added, error_count)."""
    session = SessionLocal()
    try:
        run, result = CollectionService(session).collect(req)
        count = result.count
        errors = len(result.errors)
        if count:
            logger.info(
                "✓ keyword=%r location=%r remote=%s jobs=%d errors=%d",
                req.search_term, req.location, req.is_remote, count, errors,
            )
        return count, errors
    except Exception:
        logger.exception("✗ keyword=%r location=%r failed", req.search_term, req.location)
        return 0, 1
    finally:
        session.close()


def run_collection() -> None:
    settings = get_settings()
    requests = _build_requests(settings)
    dispatcher = NotificationDispatcher.from_settings(settings)

    started = datetime.now(UTC)
    total_collected = 0
    total_errors = 0

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        futures = {pool.submit(_run_one, req): req for req in requests}
        for i, future in enumerate(as_completed(futures), 1):
            count, errors = future.result()
            total_collected += count
            total_errors += errors
            if i % 10 == 0 or i == len(requests):
                elapsed = (datetime.now(UTC) - started).seconds // 60
                logger.info("progress %d/%d | %d jobs | %dm elapsed", i, len(requests), total_collected, elapsed)

    elapsed_min = (datetime.now(UTC) - started).seconds // 60
    msg = (
        f"Hourly run done in {elapsed_min}m — "
        f"{total_collected} jobs across {len(requests)} searches, {total_errors} errors."
    )
    logger.info(msg)
    dispatcher.send(msg)


def run_direct_scrape() -> None:
    """Scrape Greenhouse/Lever/Ashby for .NET jobs and upsert into DB."""
    logger.info("direct scrape: starting")
    try:
        raw_jobs = scrape_direct_jobs()
    except Exception:
        logger.exception("direct scrape: unexpected error")
        return

    if not raw_jobs:
        logger.info("direct scrape: no jobs found")
        return

    session = SessionLocal()
    try:
        repo = JobRepository(session)
        upserted = repo.upsert_jobs(raw_jobs, search_run=None)
        session.commit()
        logger.info("direct scrape: upserted %d jobs (raw=%d)", len(upserted), len(raw_jobs))
    except Exception:
        logger.exception("direct scrape: DB upsert failed")
        session.rollback()
    finally:
        session.close()


def run_h1b_company_schedule() -> None:
    """Run scheduled H1B company-target searches."""
    req = build_h1b_company_request()
    session = SessionLocal()
    try:
        run, result = CollectionService(session).collect(req)
        logger.info(
            "h1b company schedule done run_id=%s targets=%s jobs=%s errors=%s",
            run.id,
            req.company_target_limit,
            result.count,
            len(result.errors),
        )
    except Exception:
        logger.exception("h1b company schedule failed")
    finally:
        session.close()


def main() -> None:
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    init_database()
    scheduler = BlockingScheduler(timezone="America/Chicago")

    # LinkedIn/Indeed/etc — existing interval
    scheduler.add_job(
        run_collection,
        "interval",
        hours=settings.scheduler_hours,
        id="collect_jobs",
        next_run_time=datetime.now(UTC),
    )

    scheduler.add_job(
        run_h1b_company_schedule,
        "interval",
        hours=H1B_COMPANY_INTERVAL_HOURS,
        id="h1b_company_schedule",
        next_run_time=datetime.now(UTC),
        max_instances=1,
        coalesce=True,
    )

    # Direct company portals — hourly during day (7AM-7PM CDT), every 4h overnight
    for hh in range(7, 20):  # 7:00 through 19:00 CDT = hourly
        scheduler.add_job(
            run_direct_scrape,
            "cron",
            hour=hh, minute=0,
            id=f"direct_scrape_{hh:02d}00",
            max_instances=1,
            coalesce=True,
        )
    # Night runs: 23:00, 03:00 CDT (4h apart)
    for hh in [23, 3]:
        scheduler.add_job(
            run_direct_scrape,
            "cron",
            hour=hh, minute=0,
            id=f"direct_scrape_night_{hh:02d}00",
            max_instances=1,
            coalesce=True,
        )

    logger.info(
        "scheduler ready — LinkedIn/Indeed every %sh | direct portals hourly 7AM-7PM + 4h overnight CDT",
        settings.scheduler_hours,
    )
    scheduler.start()


if __name__ == "__main__":
    main()
