"""Deterministic role and U.S. location matching for career alerts."""

from __future__ import annotations

import re

from career_alerts.types import CareerJob, MatchedJob, Stream

_DOTNET_TECHNOLOGY = re.compile(
    r"(?<!\w)(?:\.net\b|dotnet\b|c#|csharp\b|asp\.net(?: core)?\b)", re.IGNORECASE
)
_DEVELOPMENT_TITLE = re.compile(r"\b(?:developer|engineer|programmer|architect)\b", re.IGNORECASE)
_AI_TITLE = re.compile(
    r"\b(?:"
    r"ai engineer|applied ai engineer|artificial intelligence engineer|"
    r"machine learning engineer|ml engineer|llm engineer|"
    r"(?:generative ai|genai) engineer|ai/ml engineer|"
    r"software engineer[, /-]+ai"
    r")\b",
    re.IGNORECASE,
)
_AI_TECHNOLOGY = re.compile(r"\b(?:python|backend|api|cloud|rag|llm)\b", re.IGNORECASE)

_DFW_CITIES = frozenset(
    {
        "dallas", "fort worth", "arlington", "plano", "irving", "frisco", "richardson",
        "garland", "mckinney", "carrollton", "addison", "coppell", "grapevine",
        "lewisville", "denton", "allen", "grand prairie",
    }
)
_US_STATE_CODES = frozenset(
    {
        "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in",
        "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv",
        "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn",
        "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc",
    }
)
_US_STATE_NAMES = frozenset(
    {
        "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut",
        "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
        "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
        "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada",
        "new hampshire", "new jersey", "new mexico", "new york", "north carolina",
        "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island",
        "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
        "washington", "west virginia", "wisconsin", "wyoming", "district of columbia",
    }
)
_US_MARKER = re.compile(
    r"(?<!\w)(?:united states|usa|us|u\.s\.?a?\.?)(?!\w)", re.IGNORECASE
)


def classify_location(job: CareerJob) -> str | None:
    """Return the presentation bucket only for locations eligible to work in the U.S."""
    location = job.location.strip().lower()
    if not _is_us_location(location):
        return None
    if job.is_remote or "remote" in location:
        return "Remote"
    if any(city in location for city in _DFW_CITIES):
        return "DFW Metro"
    return "Other USA"


def match_job(job: CareerJob) -> MatchedJob | None:
    """Match a U.S.-eligible career job to one or more supported alert streams."""
    location_bucket = classify_location(job)
    if location_bucket is None:
        return None

    streams: set[Stream] = set()
    if _DOTNET_TECHNOLOGY.search(job.title) and _DEVELOPMENT_TITLE.search(job.title):
        streams.add("dotnet")
    if _AI_TITLE.search(job.title) and _AI_TECHNOLOGY.search(f"{job.title} {job.description}"):
        streams.add("ai_engineer")

    if not streams:
        return None
    return MatchedJob(job=job, streams=frozenset(streams), location_bucket=location_bucket)


def ai_title_needs_supporting_description(title: str) -> bool:
    """Return whether an AI-role title needs body text to satisfy matching."""
    return bool(_AI_TITLE.search(title) and not _AI_TECHNOLOGY.search(title))


def _is_us_location(location: str) -> bool:
    if _US_MARKER.search(location):
        return True
    tokens = set(re.findall(r"[a-z]+", location))
    if tokens & _US_STATE_CODES:
        return True
    return any(state in location for state in _US_STATE_NAMES)
