from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class CollectionRequest(BaseModel):
    search_term: str
    location: str = "United States"
    sites: list[str] = Field(default_factory=lambda: ["linkedin", "indeed"])
    results_wanted: int = Field(default=1000, ge=1, le=5000)
    country_indeed: str = "usa"
    is_remote: bool = False
    job_type: str | None = None
    hours_old: float | None = Field(default=None, gt=0)
    use_company_targets: bool = False
    company_target_limit: int = Field(default=25, ge=1, le=100)
    visa_friendly_only: bool = False
    skip_expand: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("country_indeed", mode="before")
    @classmethod
    def _lock_country(cls, v: object) -> str:
        return "usa"


class CollectionResult(BaseModel):
    request: CollectionRequest
    run_started_at: datetime
    run_finished_at: datetime
    jobs: list[dict[str, Any]]
    errors: list[str] = Field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.jobs)


class Collector(ABC):
    @abstractmethod
    def collect(self, request: CollectionRequest) -> CollectionResult:
        raise NotImplementedError


def now_utc() -> datetime:
    return datetime.now(UTC)
