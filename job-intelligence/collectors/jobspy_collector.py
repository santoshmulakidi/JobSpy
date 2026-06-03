from __future__ import annotations

import logging
import time
from typing import Any

import pandas as pd
from jobspy import scrape_jobs

from collectors.base import CollectionRequest, CollectionResult, Collector, now_utc
from collectors.dedup import deduplicate_jobs

logger = logging.getLogger(__name__)


class JobSpyCollector(Collector):
    def __init__(self, max_attempts: int = 3, backoff_seconds: float = 2.0) -> None:
        self.max_attempts = max_attempts
        self.backoff_seconds = backoff_seconds

    def collect(self, request: CollectionRequest) -> CollectionResult:
        started_at = now_utc()
        errors: list[str] = []
        dataframe: pd.DataFrame | None = None

        for attempt in range(1, self.max_attempts + 1):
            try:
                logger.info(
                    "collecting jobs search=%s location=%s sites=%s attempt=%s",
                    request.search_term,
                    request.location,
                    request.sites,
                    attempt,
                )
                dataframe = scrape_jobs(
                    site_name=request.sites,
                    search_term=request.search_term,
                    google_search_term=request.search_term,
                    location=request.location,
                    results_wanted=request.results_wanted,
                    country_indeed=request.country_indeed,
                    is_remote=request.is_remote,
                    hours_old=request.hours_old,
                )
                break
            except Exception as exc:  # Job boards fail independently and often.
                message = f"attempt {attempt} failed: {exc}"
                logger.exception(message)
                errors.append(message)
                if attempt < self.max_attempts:
                    time.sleep(self.backoff_seconds * attempt)

        jobs = self._frame_to_jobs(dataframe) if dataframe is not None else []
        jobs = deduplicate_jobs(jobs)
        return CollectionResult(
            request=request,
            run_started_at=started_at,
            run_finished_at=now_utc(),
            jobs=jobs,
            errors=errors,
        )

    @staticmethod
    def _frame_to_jobs(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
        if dataframe.empty:
            return []
        safe_frame = dataframe.where(pd.notnull(dataframe), None)
        return [dict(row) for row in safe_frame.to_dict(orient="records")]
