from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

Stream = Literal["dotnet", "ai_engineer"]
MappingStatus = Literal["verified", "unsupported", "disabled"]


@dataclass(frozen=True)
class SponsorTarget:
    rank: int
    sponsor_name: str
    canonical_company: str
    total_approvals: int
    career_url: str | None
    provider: str | None
    provider_key: str | None
    mapping_status: MappingStatus
    validation_notes: str

    @property
    def source_key(self) -> str:
        return f"{self.provider}:{self.provider_key or self.career_url}"


@dataclass(frozen=True)
class CareerJob:
    source_key: str
    provider: str
    provider_job_id: str
    company: str
    sponsor_names: tuple[str, ...]
    title: str
    location: str
    description: str
    apply_url: str
    posted_at: datetime | None
    is_remote: bool


@dataclass(frozen=True)
class MatchedJob:
    job: CareerJob
    streams: frozenset[Stream]
    location_bucket: Literal["Remote", "DFW Metro", "Other USA"]
