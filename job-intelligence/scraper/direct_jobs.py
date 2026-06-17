"""
Scrape Greenhouse / Lever / Ashby public APIs for .NET / C# / Azure jobs.

Public API docs:
  Greenhouse: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
  Lever:      https://api.lever.co/v0/postings/{slug}?mode=json
  Ashby:      POST https://jobs.ashbyhq.com/api/non-user-graphql
"""

from __future__ import annotations

import logging
import re
import time
from datetime import UTC, datetime, date
from typing import Any

import httpx

from scraper.company_list import COMPANIES

logger = logging.getLogger(__name__)

# ── Title / description filter ────────────────────────────────────────────────
# Match if the JOB TITLE contains any of these patterns.
TITLE_PATTERNS: list[re.Pattern] = [
    re.compile(p, re.I) for p in [
        r"\.net",
        r"\bdotnet\b",
        r"\bc#\b",
        r"\bcsharp\b",
        r"\basp\.net\b",
        r"\baspnet\b",
        r"azure.*developer",
        r"azure.*engineer",
        r"developer.*azure",
        r"engineer.*azure",
        r"principal.*engineer",   # broad — combine with description check
        r"staff.*engineer",       # broad — combine with description check
        r"backend.*developer",    # broad — combine with description check
    ]
]

# For "broad" patterns above, also require description to mention .NET/C#/Azure
BROAD_PATTERNS = {r"principal.*engineer", r"staff.*engineer", r"backend.*developer"}
DESCRIPTION_CONFIRM = re.compile(
    r"\.net|dotnet|c#|csharp|asp\.net|aspnet|azure|blazor|xamarin|entity framework|wpf|winforms",
    re.I
)


def _title_matches(title: str, description: str = "") -> bool:
    for pat in TITLE_PATTERNS:
        if pat.search(title):
            # broad pattern — require description confirmation
            if pat.pattern in BROAD_PATTERNS and not DESCRIPTION_CONFIRM.search(description):
                continue
            return True
    return False


def _parse_date(raw: Any) -> date | None:
    if not raw:
        return None
    try:
        if isinstance(raw, (int, float)):
            # Lever timestamps are milliseconds
            return datetime.fromtimestamp(raw / 1000, tz=UTC).date()
        if isinstance(raw, str):
            for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d"):
                try:
                    return datetime.strptime(raw[:19], fmt[:len(raw)]).date()
                except ValueError:
                    pass
            # ISO with timezone suffix
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except Exception:
        pass
    return None


def _salary_from_greenhouse(job: dict) -> tuple[float | None, float | None, str | None]:
    """Extract min/max/currency from Greenhouse job metadata."""
    keyed = {m.get("name", "").lower(): m.get("value") for m in job.get("metadata", [])}
    # common field names companies use
    for key in ("salary", "compensation", "pay range", "salary range"):
        val = keyed.get(key)
        if val and isinstance(val, str):
            nums = re.findall(r"[\d,]+", val.replace(",", ""))
            floats = [float(n) for n in nums if n]
            if len(floats) >= 2:
                return floats[0], floats[1], "USD"
            if len(floats) == 1:
                return floats[0], None, "USD"
    return None, None, None


# ── Greenhouse ────────────────────────────────────────────────────────────────
_GH_BASE = "https://boards-api.greenhouse.io/v1/boards"


def fetch_greenhouse(slug: str, company_name: str, client: httpx.Client) -> list[dict]:
    url = f"{_GH_BASE}/{slug}/jobs?content=true"
    try:
        r = client.get(url, timeout=15)
        if r.status_code == 404:
            logger.debug("greenhouse %s: 404 (slug may be wrong)", slug)
            return []
        r.raise_for_status()
    except httpx.HTTPError as e:
        logger.warning("greenhouse %s: %s", slug, e)
        return []

    jobs = r.json().get("jobs", [])
    results = []
    for job in jobs:
        title = job.get("title", "")
        content = job.get("content", "")
        if not _title_matches(title, content):
            continue
        loc = job.get("location", {})
        location = loc.get("name") if isinstance(loc, dict) else str(loc or "")
        is_remote = bool(re.search(r"\bremote\b", (location or "") + " " + title, re.I))
        min_sal, max_sal, currency = _salary_from_greenhouse(job)
        results.append({
            "source": "greenhouse",
            "source_job_id": f"{slug}-{job['id']}",
            "title": title,
            "company_name": company_name,
            "job_url": job.get("absolute_url"),
            "location": location,
            "description": re.sub(r"<[^>]+>", " ", content or "").strip(),
            "is_remote": is_remote,
            "date_posted": _parse_date(job.get("updated_at")),
            "min_amount": min_sal,
            "max_amount": max_sal,
            "currency": currency,
        })
    return results


# ── Lever ─────────────────────────────────────────────────────────────────────
_LEVER_BASE = "https://api.lever.co/v0/postings"


def fetch_lever(slug: str, company_name: str, client: httpx.Client) -> list[dict]:
    url = f"{_LEVER_BASE}/{slug}?mode=json&limit=500"
    try:
        r = client.get(url, timeout=15)
        if r.status_code == 404:
            logger.debug("lever %s: 404", slug)
            return []
        r.raise_for_status()
    except httpx.HTTPError as e:
        logger.warning("lever %s: %s", slug, e)
        return []

    postings = r.json()
    if not isinstance(postings, list):
        return []

    results = []
    for job in postings:
        title = job.get("text", "")
        # Lever description is nested
        lists = job.get("descriptionPlain") or ""
        desc_parts = [job.get("descriptionPlain", ""), job.get("additionalPlain", "")]
        description = "\n".join(p for p in desc_parts if p)
        if not _title_matches(title, description):
            continue
        cats = job.get("categories", {})
        location = cats.get("location", "")
        team = cats.get("team", "")
        is_remote = bool(re.search(r"\bremote\b", (location or "") + " " + title, re.I))
        results.append({
            "source": "lever",
            "source_job_id": f"{slug}-{job['id']}",
            "title": title,
            "company_name": company_name,
            "job_url": job.get("hostedUrl"),
            "location": location,
            "description": description,
            "is_remote": is_remote,
            "date_posted": _parse_date(job.get("createdAt")),
            "min_amount": None,
            "max_amount": None,
            "currency": None,
        })
    return results


# ── Ashby ─────────────────────────────────────────────────────────────────────
_ASHBY_URL = "https://jobs.ashbyhq.com/api/non-user-graphql"
_ASHBY_QUERY = """
query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
  jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
    jobPostings {
      id
      title
      locationName
      isRemote
      descriptionPlain
      publishedAt
      jobLocation { name }
      compensation { minValue maxValue currencyCode }
      externalLink
    }
  }
}
"""


def fetch_ashby(slug: str, company_name: str, client: httpx.Client) -> list[dict]:
    payload = {
        "operationName": "ApiJobBoardWithTeams",
        "variables": {"organizationHostedJobsPageName": slug},
        "query": _ASHBY_QUERY,
    }
    try:
        r = client.post(_ASHBY_URL, json=payload, timeout=15)
        r.raise_for_status()
    except httpx.HTTPError as e:
        logger.warning("ashby %s: %s", slug, e)
        return []

    board = r.json().get("data", {}).get("jobBoard")
    if not board:
        return []

    results = []
    for job in board.get("jobPostings", []):
        title = job.get("title", "")
        description = job.get("descriptionPlain", "") or ""
        if not _title_matches(title, description):
            continue
        loc = job.get("jobLocation") or {}
        location = loc.get("name") or job.get("locationName", "")
        is_remote = bool(job.get("isRemote") or re.search(r"\bremote\b", location or "", re.I))
        comp = job.get("compensation") or {}
        results.append({
            "source": "ashby",
            "source_job_id": f"{slug}-{job['id']}",
            "title": title,
            "company_name": company_name,
            "job_url": job.get("externalLink") or f"https://jobs.ashbyhq.com/{slug}/{job['id']}",
            "location": location,
            "description": description,
            "is_remote": is_remote,
            "date_posted": _parse_date(job.get("publishedAt")),
            "min_amount": comp.get("minValue"),
            "max_amount": comp.get("maxValue"),
            "currency": comp.get("currencyCode"),
        })
    return results


# ── Main entry point ─────────────────────────────────────────────────────────
_FETCHERS = {
    "greenhouse": fetch_greenhouse,
    "lever": fetch_lever,
    "ashby": fetch_ashby,
}


def scrape_direct_jobs(
    *,
    companies: list[tuple[str, str, str]] | None = None,
    delay: float = 0.5,
) -> list[dict]:
    """
    Scrape all companies. Returns raw job dicts ready for DB upsert.
    companies defaults to COMPANIES from company_list.py.
    delay = seconds between requests (be polite).
    """
    targets = companies or COMPANIES
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; JobIntelligenceBot/1.0; +https://github.com/santoshmulakidi/JobSpy)",
        "Accept": "application/json",
    }
    all_jobs: list[dict] = []
    seen_slugs: set[str] = set()

    with httpx.Client(headers=headers, follow_redirects=True) as client:
        for platform, slug, display_name in targets:
            if slug in seen_slugs:
                continue
            seen_slugs.add(slug)

            fetcher = _FETCHERS.get(platform)
            if not fetcher:
                logger.warning("unknown platform %s for %s", platform, display_name)
                continue

            try:
                jobs = fetcher(slug, display_name, client)
                if jobs:
                    logger.info("direct %s/%s: %d .NET jobs", platform, slug, len(jobs))
                all_jobs.extend(jobs)
            except Exception as e:
                logger.exception("direct %s/%s: unexpected error: %s", platform, slug, e)

            time.sleep(delay)

    logger.info("direct scrape total: %d jobs from %d companies", len(all_jobs), len(targets))
    return all_jobs
