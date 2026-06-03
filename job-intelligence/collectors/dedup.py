from __future__ import annotations

import hashlib
import re
from typing import Any


_WHITESPACE = re.compile(r"\s+")


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return _WHITESPACE.sub(" ", str(value).strip().lower())


def fingerprint_job(job: dict[str, Any]) -> str:
    source = normalize_text(job.get("site") or job.get("source"))
    external_id = normalize_text(job.get("id") or job.get("job_id"))
    url = normalize_text(job.get("job_url"))
    if source and (external_id or url):
        raw = "|".join([source, external_id or url])
    else:
        raw = "|".join(
            [
                normalize_text(job.get("title")),
                normalize_text(job.get("company") or job.get("company_name")),
                normalize_text(job.get("location")),
            ]
        )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def deduplicate_jobs(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for job in jobs:
        fingerprint = fingerprint_job(job)
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        job["fingerprint"] = fingerprint
        unique.append(job)
    return unique
