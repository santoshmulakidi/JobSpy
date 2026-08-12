from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from career_alerts.types import SponsorTarget

_MAPPING_STATUSES = {"verified", "unsupported", "disabled"}
_FORBIDDEN_HOSTS = {"indeed.com", "linkedin.com"}
_FORBIDDEN_TERMS = ("firecrawl",)


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    return str(value)


def load_registry(path: Path) -> list[SponsorTarget]:
    """Load registry JSON with explicit conversions into immutable target records."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise TypeError("registry root must be a JSON array")

    targets: list[SponsorTarget] = []
    for index, row in enumerate(payload, start=1):
        if not isinstance(row, dict):
            raise TypeError(f"registry row {index} must be an object")
        try:
            target = SponsorTarget(
                rank=int(row["rank"]),
                sponsor_name=str(row["sponsor_name"]),
                canonical_company=str(row["canonical_company"]),
                total_approvals=int(row["total_approvals"]),
                career_url=_optional_text(row.get("career_url")),
                provider=_optional_text(row.get("provider")),
                provider_key=_optional_text(row.get("provider_key")),
                mapping_status=str(row["mapping_status"]),  # type: ignore[arg-type]
                validation_notes=str(row["validation_notes"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"invalid registry row {index}: {exc}") from exc
        targets.append(target)
    return targets


def _is_forbidden_url(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return any(host == forbidden or host.endswith(f".{forbidden}") for forbidden in _FORBIDDEN_HOSTS)


def validate_registry(targets: list[SponsorTarget]) -> list[str]:
    """Return all registry validation errors without silently activating candidates."""
    errors: list[str] = []
    rank_counts = Counter(target.rank for target in targets)
    sponsor_counts = Counter(target.sponsor_name.strip().casefold() for target in targets)

    # One- and two-row registries are supported for source-level validation and review fixtures.
    # Any larger input is a Top-250 snapshot and must be complete.
    if len(targets) > 2:
        actual_ranks = set(rank_counts)
        expected_ranks = set(range(1, 251))
        if actual_ranks != expected_ranks or len(targets) != 250:
            missing = sorted(expected_ranks - actual_ranks)
            extra = sorted(actual_ranks - expected_ranks)
            errors.append(f"ranks must be 1-250 exactly once; missing={missing}, extra={extra}")

    for target in targets:
        label = f"rank {target.rank} ({target.sponsor_name})"
        if not 1 <= target.rank <= 250:
            errors.append(f"{label}: rank must be between 1 and 250")
        if rank_counts[target.rank] > 1:
            errors.append(f"{label}: duplicate rank")
        if sponsor_counts[target.sponsor_name.strip().casefold()] > 1:
            errors.append(f"{label}: duplicate sponsor row")
        if not target.sponsor_name.strip() or not target.canonical_company.strip():
            errors.append(f"{label}: sponsor and canonical company names must be non-empty")
        if target.total_approvals < 0:
            errors.append(f"{label}: total_approvals cannot be negative")
        if not target.validation_notes.strip():
            errors.append(f"{label}: requires non-empty validation_notes")
        if target.mapping_status not in _MAPPING_STATUSES:
            errors.append(f"{label}: invalid mapping_status {target.mapping_status!r}")
        elif target.mapping_status == "disabled":
            errors.append(f"{label}: disabled candidate cannot be activated without human review")

        has_provider = bool(target.provider and target.provider.strip())
        has_provider_key = bool(target.provider_key and target.provider_key.strip())
        if has_provider != has_provider_key:
            errors.append(f"{label}: provider and provider_key must both be set or both be null")

        if target.mapping_status == "verified":
            parsed = urlparse(target.career_url or "")
            if parsed.scheme != "https" or not parsed.hostname:
                errors.append(f"{label}: verified target requires an HTTPS official careers URL")
            if not has_provider or not has_provider_key:
                errors.append(f"{label}: verified target requires provider and provider_key")

        searchable = " ".join(
            value for value in (target.career_url, target.provider, target.provider_key) if value
        ).lower()
        if target.career_url and _is_forbidden_url(target.career_url):
            errors.append(f"{label}: career_url must be an official careers URL, not an aggregator")
        if any(term in searchable for term in _FORBIDDEN_TERMS):
            errors.append(f"{label}: paid Firecrawl sources are forbidden")

    return errors
