"""Collection and per-stream delivery orchestration for career alerts."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from career_alerts.emailer import EmailJob, SmtpMailer, render_email
from career_alerts.matching import match_job
from career_alerts.providers import FetchResult, collect_sources
from career_alerts.registry import load_registry, validate_registry
from career_alerts.state import CareerAlertState
from career_alerts.types import CareerJob, MatchedJob, SponsorTarget, Stream
from career_alerts.windows import DeliveryWindow, delivery_window


class Mailer(Protocol):
    def send(self, message: object) -> None: ...


@dataclass(frozen=True)
class RunSummary:
    attempted_sources: int
    succeeded_sources: int
    degraded_sources: int
    failed_sources: int
    fetched_jobs: int
    matched_jobs: int
    delivery_counts: dict[Stream, int]
    delivery_failed: bool
    checkpoint: str

    @classmethod
    def empty(cls, checkpoint: str) -> RunSummary:
        return cls(0, 0, 0, 0, 0, 0, {}, False, checkpoint)

    def as_dict(self) -> dict[str, object]:
        return {
            "attempted_sources": self.attempted_sources,
            "succeeded_sources": self.succeeded_sources,
            "degraded_sources": self.degraded_sources,
            "failed_sources": self.failed_sources,
            "fetched_jobs": self.fetched_jobs,
            "matched_jobs": self.matched_jobs,
            "new_jobs": sum(self.delivery_counts.values()),
            "duplicate_jobs": 0,
            "emailed_jobs": sum(self.delivery_counts.values()),
            "delivery_counts": self.delivery_counts,
            "delivery_failed": self.delivery_failed,
            "checkpoint": self.checkpoint,
        }


class CareerAlertRunner:
    """Collect verified sources and deliver pending matches one stream at a time."""

    def __init__(
        self,
        *,
        registry_path: str | Path | None = None,
        registry_loader: Callable[[Path], list[SponsorTarget]] = load_registry,
        registry_validator: Callable[[list[SponsorTarget]], list[str]] = validate_registry,
        collector: Callable[[list[SponsorTarget]], object] = collect_sources,
        state: CareerAlertState,
        matcher: Callable[[CareerJob], MatchedJob | None] = match_job,
        mailer: Mailer | None = None,
        renderer: Callable[[Stream, DeliveryWindow, Sequence[EmailJob]], list[object]] = render_email,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.registry_path = Path(registry_path) if registry_path else Path()
        self.registry_loader = registry_loader
        self.registry_validator = registry_validator
        self.collector = collector
        self.state = state
        self.matcher = matcher
        self.mailer = mailer or SmtpMailer()
        self.renderer = renderer
        self.clock = clock

    def collect(self, send_email: bool, initial: bool) -> RunSummary:
        targets = self.registry_loader(self.registry_path)
        errors = self.registry_validator(targets)
        if errors:
            raise ValueError("registry invalid: " + "; ".join(errors))
        active_targets = [
            target for group in _group_shared_sources(targets) for target in group
        ]
        results = _await(self.collector(active_targets))
        now = self.clock()
        matches: list[MatchedJob] = []
        for result in results:
            self.state.record_source_result(result, now)
            matches.extend(match for job in result.jobs if (match := self.matcher(job)) is not None)
        self.state.upsert_matches(matches, now)
        delivery_counts: dict[Stream, int] = {}
        delivery_failed = False
        if send_email:
            for stream in ("dotnet", "ai_engineer"):
                candidates = self.state.stream_jobs(stream, include_delivered=initial)
                if not candidates:
                    continue
                jobs = [EmailJob(match, first_seen) for _, match, first_seen in candidates]
                success = True
                try:
                    for message in self.renderer(stream, _window(now, initial), jobs):
                        self.mailer.send(message)
                except Exception:  # noqa: BLE001
                    success = False
                    delivery_failed = True
                self.state.record_delivery(
                    stream, [key for key, _, _ in candidates], now, success=success
                )
                if success:
                    delivery_counts[stream] = len(candidates)
        failed = sum(result.error_code not in {None, "no_open_jobs"} for result in results)
        return RunSummary(
            len(results), len(results) - failed, failed, failed, sum(len(result.jobs) for result in results),
            len(matches), delivery_counts, delivery_failed,
            now.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        )


def _await(value: object) -> list[FetchResult]:
    if not hasattr(value, "__await__"):
        return value  # type: ignore[return-value]
    return asyncio.run(value)  # type: ignore[arg-type]


def _window(now: datetime, initial: bool) -> DeliveryWindow:
    if initial:
        return DeliveryWindow(now, now, "Initial activation", "regular")
    return delivery_window(now)


def _group_shared_sources(targets: list[SponsorTarget]) -> list[list[SponsorTarget]]:
    """Preserve each verified source group for collect_sources' one-fetch grouping."""
    grouped: dict[str, list[SponsorTarget]] = {}
    for target in targets:
        if target.mapping_status == "verified":
            grouped.setdefault(target.source_key, []).append(target)
    return list(grouped.values())
