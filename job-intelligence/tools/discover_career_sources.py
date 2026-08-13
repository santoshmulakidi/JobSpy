from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse, urlunsplit

import httpx
import pandas as pd
import tldextract
from ats_scrapers import find_company

from career_alerts.registry import provider_matches_url

DEFAULT_OUTPUT = Path("data/top250_career_candidates.json")
DEFAULT_REVIEW = Path("data/top250_career_targets.review.json")
ATS_MANIFEST_URL = "https://storage.stapply.ai/jobhive/v1/manifest.json"
ATS_DIRECTORY_PACKAGE = "ats-scrapers"
ATS_DIRECTORY_VERSION = "0.2.0"
FORBIDDEN_HOSTS = {
    "careerbuilder.com",
    "glassdoor.com",
    "indeed.com",
    "join.com",
    "linkedin.com",
    "monster.com",
    "ziprecruiter.com",
}
LEGAL_WORDS = {
    "america",
    "americas",
    "and",
    "com",
    "company",
    "corp",
    "corporation",
    "inc",
    "limited",
    "llc",
    "lp",
    "ltd",
    "services",
    "solutions",
    "the",
    "u",
    "us",
}


def is_aggregator(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == item or host.endswith(f".{item}") for item in FORBIDDEN_HOSTS)


def search_names(sponsor_name: str) -> list[str]:
    normalized = re.sub(r"[^a-z0-9]+", " ", sponsor_name.lower()).strip()
    compact = " ".join(word for word in normalized.split() if word not in LEGAL_WORDS)
    names = [sponsor_name, normalized]
    if compact:
        names.append(compact)
    return list(dict.fromkeys(names))


def ats_candidates(sponsor_name: str) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for query in search_names(sponsor_name):
        try:
            matches = find_company(query, limit=10)
        except (httpx.HTTPError, OSError, ValueError):
            matches = None
        if matches is None:
            continue
        for row in matches.to_dict(orient="records"):
            provider = str(row.get("ats") or "").strip()
            provider_key = str(row.get("slug") or "").strip()
            url = str(row.get("url") or "").strip()
            identity = (provider, provider_key)
            if not provider or not provider_key or not url or identity in seen or is_aggregator(url):
                continue
            seen.add(identity)
            candidates.append(
                {
                    "career_url": url,
                    "provider": provider,
                    "provider_key": provider_key,
                    "evidence_source": f"ats_scrapers.find_company({query!r})",
                }
            )
        if candidates:
            break
    return candidates


def _directory_record_sha256(record: dict[str, str]) -> str:
    encoded = json.dumps(record, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def ats_directory_match(
    directory: pd.DataFrame,
    sponsor_name: str,
    canonical_company: str,
    provider: str,
    provider_key: str,
    career_url: str,
) -> dict[str, str] | None:
    """Return the exact pinned find_company record that activates a tenant."""
    queries = list(
        dict.fromkeys(search_names(sponsor_name) + search_names(canonical_company))
    )
    for query in queries:
        needle = query.strip().casefold()
        names = directory["name"].fillna("").astype(str).str.casefold()
        slugs = directory["slug"].fillna("").astype(str).str.casefold()
        matches = directory[
            names.str.contains(needle, regex=False)
            | slugs.str.contains(needle, regex=False)
        ].copy()
        rank = (slugs.loc[matches.index] != needle).astype(int) * 2 + (
            names.loc[matches.index] != needle
        ).astype(int)
        matches = matches.loc[rank.sort_values(kind="stable").index].head(10)
        for raw in matches.to_dict(orient="records"):
            record = {
                "ats": str(raw.get("ats") or "").strip(),
                "name": str(raw.get("name") or "").strip(),
                "slug": str(raw.get("slug") or "").strip(),
                "url": str(raw.get("url") or "").strip(),
            }
            if (
                record["ats"] == provider
                and record["slug"] == provider_key
                and record["url"] == career_url
            ):
                return {
                    "directory_package": ATS_DIRECTORY_PACKAGE,
                    "directory_version": ATS_DIRECTORY_VERSION,
                    "matched_query": query,
                    "matched_company": record["name"],
                    "matched_provider": record["ats"],
                    "matched_provider_key": record["slug"],
                    "matched_url": record["url"],
                    "directory_record_sha256": _directory_record_sha256(record),
                }
    return None


def load_pinned_ats_directory(
    client: httpx.Client, manifest_url: str = ATS_MANIFEST_URL
) -> tuple[pd.DataFrame, dict[str, str]]:
    """Fetch, hash, parse, and return the exact CSV recorded as review evidence."""
    if importlib.metadata.version(ATS_DIRECTORY_PACKAGE) != ATS_DIRECTORY_VERSION:
        raise RuntimeError(
            f"{ATS_DIRECTORY_PACKAGE}=={ATS_DIRECTORY_VERSION} is required for review"
        )
    response = client.get(manifest_url)
    response.raise_for_status()
    manifest = response.json()
    companies = manifest.get("companies", {})
    source_url = companies.get("csv")
    source_sha256 = companies.get("sha256")
    if (
        manifest.get("generator") != f"{ATS_DIRECTORY_PACKAGE}/{ATS_DIRECTORY_VERSION}"
        or not isinstance(source_url, str)
        or not isinstance(source_sha256, str)
        or not re.fullmatch(r"[0-9a-f]{64}", source_sha256)
    ):
        raise ValueError("ATS manifest does not identify the pinned companies inventory")
    csv_response = client.get(source_url)
    csv_response.raise_for_status()
    actual_sha256 = hashlib.sha256(csv_response.content).hexdigest()
    if actual_sha256 != source_sha256:
        raise ValueError("downloaded ATS companies CSV does not match manifest SHA-256")
    directory = pd.read_csv(BytesIO(csv_response.content))
    if not {"ats", "name", "slug", "url"} <= set(directory.columns):
        raise ValueError("ATS companies CSV lacks required identity columns")
    return directory, {
        "directory_source_url": source_url,
        "directory_source_sha256": actual_sha256,
    }


def direct_ats_url(provider: str, provider_key: str) -> str | None:
    """Build canonical public ATS URLs for providers with stable tenant URL shapes."""
    if provider == "ashby":
        return f"https://jobs.ashbyhq.com/{provider_key}"
    if provider == "greenhouse":
        return f"https://job-boards.greenhouse.io/{provider_key}"
    if provider == "lever":
        return f"https://jobs.lever.co/{provider_key}"
    if provider == "smartrecruiters":
        return f"https://careers.smartrecruiters.com/{provider_key}"
    if provider == "workable":
        return f"https://apply.workable.com/{provider_key}"
    if provider == "avature":
        return f"https://{provider_key}.avature.net/careers/SearchJobs"
    if provider == "eightfold":
        return f"https://{provider_key}.eightfold.ai/careers"
    if provider == "workday" and "/" in provider_key:
        tenant, board = provider_key.split("/", 1)
        return f"https://{tenant}.wd5.myworkdayjobs.com/{board}"
    return None


def freehire_candidates(client: httpx.Client, sponsor_name: str) -> list[dict[str, str]]:
    try:
        response = client.get(
            "https://freehire.me/api/v1/companies",
            params={"q": sponsor_name, "limit": 10},
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return []

    candidates: list[dict[str, str]] = []
    for row in payload.get("data", []):
        url = str(row.get("url") or row.get("careers_url") or "").strip()
        provider = str(row.get("provider") or "").strip()
        provider_key = str(row.get("board") or row.get("slug") or "").strip()
        if url and provider and provider_key and not is_aggregator(url):
            candidates.append(
                {
                    "career_url": url,
                    "provider": provider,
                    "provider_key": provider_key,
                    "evidence_source": "Freehire public company directory",
                }
            )
    return candidates


_TLD_EXTRACT = tldextract.TLDExtract(suffix_list_urls=())


def registrable_domain(host: str) -> str:
    """Return the public-suffix-aware registrable domain without network updates."""
    extracted = _TLD_EXTRACT(host.lower().rstrip("."))
    return extracted.top_domain_under_public_suffix or host.lower().rstrip(".")


def validate_http(
    client: httpx.Client,
    url: str | None,
    *,
    allowed_final_hosts: set[str] | None = None,
) -> dict[str, object]:
    """Record reachability, HTTP success, and redirect identity as separate facts."""
    if not url:
        return {
            "reachable": False,
            "http_success": False,
            "redirect_identity_ok": False,
            "ok": False,
            "status_code": None,
            "final_url": None,
            "error": "no candidate",
        }
    try:
        response = client.get(url)
        original = urlparse(url)
        final = urlparse(str(response.url))
        original_host = (original.hostname or "").lower()
        final_host = (final.hostname or "").lower()
        allowed = {host.lower() for host in (allowed_final_hosts or set())}
        redirect_identity_ok = (
            final.scheme == "https"
            and not is_aggregator(str(response.url))
            and (
                registrable_domain(original_host) == registrable_domain(final_host)
                or final_host in allowed
            )
        )
        http_success = 200 <= response.status_code < 400
        return {
            "reachable": True,
            "http_success": http_success,
            "redirect_identity_ok": redirect_identity_ok,
            "ok": http_success and redirect_identity_ok,
            "status_code": response.status_code,
            "final_url": urlunsplit((final.scheme, final.netloc, final.path, "", "")),
            "error": None,
        }
    except httpx.HTTPError as exc:
        return {
            "reachable": False,
            "http_success": False,
            "redirect_identity_ok": False,
            "ok": False,
            "status_code": None,
            "final_url": None,
            "error": str(exc),
        }


def verified_validation_notes(
    canonical_company: str,
    provider: str,
    provider_key: str,
    http_validation: dict[str, object],
) -> str:
    """Derive verified notes solely from current structured review evidence."""
    status = http_validation.get("status_code")
    identity = f"{provider}/{provider_key}"
    if status in {403, 406}:
        return (
            f"Pinned ats-scrapers==0.2.0 directory record matched {canonical_company} "
            f"to {identity}; official ATS tenant returned HTTP {status} automation block "
            "during review on 2026-08-12."
        )
    return (
        f"Pinned ats-scrapers==0.2.0 directory record matched {canonical_company} "
        f"to {identity}; official ATS tenant returned HTTP {status} during review on "
        "2026-08-12."
    )


def unsupported_evidence(
    canonical_company: str,
    candidate_url: str | None,
    candidate_provider: str | None,
    http_validation: dict[str, object] | None,
) -> dict[str, str]:
    """Derive an unsupported reason/category solely from current review evidence."""
    if candidate_url is None:
        return {
            "unsupported_reason_category": "not_discovered",
            "evidence_method": "not_discovered",
            "evidence_status": "not_discovered",
            "reason": (
                f"No career source candidate was discovered for {canonical_company} during "
                "review on 2026-08-12."
            ),
        }
    status = http_validation.get("status_code") if isinstance(http_validation, dict) else None
    success = bool(http_validation and http_validation.get("http_success"))
    if is_aggregator(candidate_url):
        return {
            "unsupported_reason_category": "forbidden_aggregator",
            "evidence_method": "reviewed_candidate",
            "evidence_status": "forbidden_aggregator",
            "reason": (
                f"The discovered candidate uses a forbidden aggregator domain and no separate "
                f"official source identity was verified for {canonical_company} on 2026-08-12."
            ),
        }
    if candidate_provider == "html":
        category = "html_identity_unverified"
        gap = (
            "no captured independent official-page identity evidence linked "
            f"{canonical_company} to the reviewed HTML source"
        )
    else:
        category = "ats_identity_unverified"
        gap = (
            f"no exact ats-scrapers==0.2.0 directory record linked {canonical_company} "
            "to the reviewed ATS tenant"
        )
    if success:
        reason = (
            f"Candidate was HTTP-reachable (HTTP {status}) but {gap} on 2026-08-12."
        )
        evidence_status = "identity_unverified"
    elif status is not None:
        reason = f"Candidate returned HTTP {status} and {gap} on 2026-08-12."
        evidence_status = "http_failure_and_identity_unverified"
    else:
        reason = f"Candidate was unreachable and {gap} on 2026-08-12."
        evidence_status = "unreachable_and_identity_unverified"
    return {
        "unsupported_reason_category": category,
        "evidence_method": "reviewed_candidate",
        "evidence_status": evidence_status,
        "reason": reason,
    }


def apply_review_decisions(
    sponsors: list[dict[str, object]], decisions_path: Path
) -> list[dict[str, object]]:
    """Materialize an explicitly human-reviewed registry; never infer approval."""
    decisions = json.loads(decisions_path.read_text(encoding="utf-8"))
    by_rank: dict[int, dict[str, object]] = {}

    def add_decision(rank: int, decision: dict[str, object]) -> None:
        if rank in by_rank:
            raise ValueError(f"duplicate review decision for rank {rank}")
        by_rank[rank] = decision

    if isinstance(decisions, list):
        for row in decisions:
            if not isinstance(row, dict):
                raise TypeError("review evidence rows must be objects")
            status = row.get("decision")
            if status not in {"verified", "unsupported"}:
                raise ValueError(f"invalid review decision {status!r}")
            add_decision(
                int(row["rank"]),
                {
                    "canonical_company": row["canonical_company"],
                    "career_url": row.get("career_url"),
                    "provider": row.get("provider"),
                    "provider_key": row.get("provider_key"),
                    "mapping_status": status,
                    "validation_notes": row["decision_reason"],
                    "sponsor_name": row["sponsor_name"],
                    "total_approvals": row["total_approvals"],
                    "candidate_url": row.get("candidate_url"),
                    "candidate_provider": row.get("candidate_provider"),
                    "candidate_provider_key": row.get("candidate_provider_key"),
                },
            )
    elif isinstance(decisions, dict):
        for group in decisions.get("verified_groups", []):
            for rank in group["ranks"]:
                provider = str(group["provider"])
                provider_key = str(group["provider_key"])
                career_url = str(group["career_url"])
                if provider != "html" and not provider_matches_url(
                    provider, provider_key, career_url
                ):
                    provider = "html"
                source_path = urlparse(career_url).path
                if provider == "html" and source_path in {"", "/"}:
                    add_decision(
                        int(rank),
                        {
                            "canonical_company": group["canonical_company"],
                            "career_url": None,
                            "provider": None,
                            "provider_key": None,
                            "mapping_status": "unsupported",
                            "validation_notes": (
                                "Official-looking root career candidate lacked an independent "
                                "company-page careers-link relationship during review on "
                                "2026-08-12, so it remains inactive."
                            ),
                            "candidate_url": career_url,
                            "candidate_provider": provider,
                            "candidate_provider_key": provider_key,
                        },
                    )
                    continue
                add_decision(
                    int(rank),
                    {
                        "canonical_company": group["canonical_company"],
                        "career_url": career_url,
                        "provider": provider,
                        "provider_key": provider_key,
                        "mapping_status": "verified",
                        "validation_notes": group["validation_notes"],
                        "candidate_url": group.get("career_url"),
                        "candidate_provider": group.get("provider"),
                        "candidate_provider_key": group.get("provider_key"),
                    },
                )
        for row in decisions.get("unsupported", []):
            add_decision(
                int(row["rank"]),
                {
                    "canonical_company": row.get("canonical_company"),
                    "career_url": None,
                    "provider": None,
                    "provider_key": None,
                    "mapping_status": "unsupported",
                    "validation_notes": row["validation_notes"],
                    "candidate_url": row.get("candidate_url"),
                    "candidate_provider": row.get("candidate_provider"),
                    "candidate_provider_key": row.get("candidate_provider_key"),
                },
            )
    else:
        raise TypeError("review decisions must be an object or array")

    expected = {int(row["rank"]) for row in sponsors}
    actual = set(by_rank)
    if actual != expected:
        raise ValueError(
            f"review decisions must cover every sponsor exactly once; "
            f"missing={sorted(expected - actual)}, extra={sorted(actual - expected)}"
        )

    output: list[dict[str, object]] = []
    for sponsor in sponsors:
        rank = int(sponsor["rank"])
        decision = by_rank[rank]
        if decision.get("sponsor_name") not in {None, sponsor["sponsor_name"]}:
            raise ValueError(f"review sponsor identity mismatch at rank {rank}")
        if decision.get("total_approvals") not in {None, sponsor["total_approvals"]}:
            raise ValueError(f"review approvals mismatch at rank {rank}")
        career_url = decision["career_url"]
        provider = decision["provider"]
        provider_key = decision["provider_key"]
        if decision["mapping_status"] == "verified":
            candidate_provider = decision.get("candidate_provider")
            candidate_key = decision.get("candidate_provider_key")
            candidate_url = decision.get("candidate_url")
            if (
                isinstance(candidate_provider, str)
                and candidate_provider != "html"
                and isinstance(candidate_key, str)
            ):
                direct_url = direct_ats_url(candidate_provider, candidate_key)
                if direct_url:
                    career_url = direct_url
                    provider = candidate_provider
                    provider_key = candidate_key
                elif isinstance(candidate_url, str) and provider_matches_url(
                    candidate_provider, candidate_key, candidate_url
                ):
                    career_url = candidate_url
                    provider = candidate_provider
                    provider_key = candidate_key
        output.append(
            {
                "rank": rank,
                "sponsor_name": str(sponsor["sponsor_name"]),
                "canonical_company": decision["canonical_company"]
                or str(sponsor["sponsor_name"]),
                "total_approvals": int(sponsor["total_approvals"]),
                "career_url": career_url,
                "provider": provider,
                "provider_key": provider_key,
                "mapping_status": decision["mapping_status"],
                "validation_notes": decision["validation_notes"],
            }
        )
    return output


def review_redirect_allowlist(decisions_path: Path) -> dict[str, set[str]]:
    """Return explicit, human-reviewed final-host exceptions keyed by source URL."""
    payload = json.loads(decisions_path.read_text(encoding="utf-8"))
    allowlist: dict[str, set[str]] = {}
    if isinstance(payload, dict):
        rows = payload.get("verified_groups", [])
    elif isinstance(payload, list):
        rows = payload
    else:
        return allowlist
    for row in rows:
        if not isinstance(row, dict):
            continue
        url = row.get("career_url")
        hosts = row.get("allowed_final_hosts", [])
        if isinstance(url, str) and isinstance(hosts, list):
            allowlist[url] = {
                str(host).lower() for host in hosts if isinstance(host, str) and host
            }
    return allowlist


def review_candidate_metadata(decisions_path: Path) -> dict[int, dict[str, object]]:
    """Preserve reviewed candidates even when the final decision is unsupported."""
    payload = json.loads(decisions_path.read_text(encoding="utf-8"))
    metadata: dict[int, dict[str, object]] = {}
    if isinstance(payload, list):
        for row in payload:
            if isinstance(row, dict):
                metadata[int(row["rank"])] = {
                    "candidate_url": row.get("candidate_url"),
                    "candidate_provider": row.get("candidate_provider"),
                    "candidate_provider_key": row.get("candidate_provider_key"),
                }
        return metadata
    if not isinstance(payload, dict):
        return metadata
    for group in payload.get("verified_groups", []):
        for rank in group["ranks"]:
            metadata[int(rank)] = {
                "candidate_url": group.get("career_url"),
                "candidate_provider": group.get("provider"),
                "candidate_provider_key": group.get("provider_key"),
            }
    for row in payload.get("unsupported", []):
        metadata[int(row["rank"])] = {
            "candidate_url": row.get("candidate_url"),
            "candidate_provider": row.get("candidate_provider"),
            "candidate_provider_key": row.get("candidate_provider_key"),
        }
    return metadata


def identity_source_for(row: dict[str, object], candidate: dict[str, object]) -> str | None:
    """Choose an independently fetched identity source, distinct from the selected jobs URL."""
    candidate_provider = candidate.get("candidate_provider")
    if isinstance(candidate_provider, str) and candidate_provider != "html":
        return "https://storage.stapply.ai/jobhive/v1/companies.csv"
    url = row.get("career_url")
    if not isinstance(url, str):
        return None
    parsed = urlparse(url)
    source_url = f"{parsed.scheme}://{parsed.netloc}/"
    return source_url if source_url != url else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate disabled official-career candidates")
    parser.add_argument("--seed", type=Path, default=Path("data/top250_h1b_sponsors.json"))
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--review-output", type=Path, default=DEFAULT_REVIEW)
    parser.add_argument("--freehire", action="store_true")
    parser.add_argument(
        "--review-decisions",
        type=Path,
        help="explicit human decisions used to materialize a verified/unsupported registry",
    )
    args = parser.parse_args()

    sponsors = json.loads(args.seed.read_text(encoding="utf-8"))
    if args.review_decisions:
        output_rows = apply_review_decisions(sponsors, args.review_decisions)
        redirect_allowlist = review_redirect_allowlist(args.review_decisions)
        candidate_metadata = review_candidate_metadata(args.review_decisions)
        outcomes: dict[str, dict[str, object]] = {}
        directory_matches: dict[int, dict[str, str]] = {}
        with httpx.Client(
            follow_redirects=True,
            timeout=12,
            headers={"User-Agent": "JobIntelligence career-source review/1.0"},
        ) as client:
            directory, directory_source = load_pinned_ats_directory(client)
            urls = {
                str(row["career_url"]) for row in output_rows if row["career_url"]
            }
            urls.update(
                str(metadata["candidate_url"])
                for metadata in candidate_metadata.values()
                if metadata.get("candidate_url")
            )
            urls.add(directory_source["directory_source_url"])
            sorted_urls = sorted(urls)
            with ThreadPoolExecutor(max_workers=12) as executor:
                results = executor.map(
                    lambda url: validate_http(
                        client,
                        url,
                        allowed_final_hosts=redirect_allowlist.get(url),
                    ),
                    sorted_urls,
                )
                outcomes.update(zip(sorted_urls, results, strict=True))
        for row in output_rows:
            if row["mapping_status"] != "verified":
                continue
            candidate = candidate_metadata.get(int(row["rank"]), {})
            activated_outcome = outcomes.get(str(row["career_url"]), {})
            activated_status = activated_outcome.get("status_code")
            provider = row.get("provider")
            directory_match = None
            if isinstance(provider, str) and provider != "html":
                directory_match = ats_directory_match(
                    directory,
                    str(row["sponsor_name"]),
                    str(row["canonical_company"]),
                    provider,
                    str(row["provider_key"]),
                    str(row["career_url"]),
                )
            if directory_match is not None:
                directory_matches[int(row["rank"])] = directory_match
            identity_failed = directory_match is None
            activated_failed = (
                not activated_outcome.get("http_success")
                and activated_status not in {403, 406}
            )
            if identity_failed or activated_failed:
                previous_url = row["career_url"]
                candidate_metadata[int(row["rank"])] = {
                    "candidate_url": candidate.get("candidate_url") or previous_url,
                    "candidate_provider": candidate.get("candidate_provider") or row["provider"],
                    "candidate_provider_key": candidate.get("candidate_provider_key")
                    or row["provider_key"],
                }
                row["career_url"] = None
                row["provider"] = None
                row["provider_key"] = None
                row["mapping_status"] = "unsupported"
                if identity_failed:
                    if provider == "html":
                        row["validation_notes"] = (
                            "No captured independent official page content and outbound careers "
                            "link proved this HTML candidate during review on 2026-08-12, so it "
                            "remains inactive."
                        )
                    else:
                        row["validation_notes"] = (
                            "ats-scrapers==0.2.0 find_company returned no exact sponsor/company "
                            "record matching this provider, key, and URL during review on "
                            "2026-08-12, so the candidate remains inactive."
                        )
                else:
                    row["validation_notes"] = (
                        f"Known official candidate returned HTTP {activated_status} during review "
                        "on 2026-08-12; source remains inactive until a working official endpoint "
                        "is confirmed."
                    )
            else:
                row["validation_notes"] = verified_validation_notes(
                    str(row["canonical_company"]),
                    str(row["provider"]),
                    str(row["provider_key"]),
                    activated_outcome,
                )
        review_rows = []
        for row in output_rows:
            url = row["career_url"]
            candidate = candidate_metadata.get(int(row["rank"]), {})
            candidate_url = candidate.get("candidate_url")
            if row["mapping_status"] == "verified":
                candidate_url = url
                candidate = {
                    "candidate_url": url,
                    "candidate_provider": row["provider"],
                    "candidate_provider_key": row["provider_key"],
                }
                allowed_hosts = sorted(redirect_allowlist.get(str(url), set()))
                directory_evidence = directory_matches[int(row["rank"])]
                identity_method = "official_ats_directory"
                identity_source_url = directory_source["directory_source_url"]
                identity_observation = "Pinned ats-scrapers company-directory record."
                identity_source_validation = outcomes.get(str(identity_source_url), {})
                identity_source_final_url = identity_source_validation.get("final_url")
                identity_source_status = identity_source_validation.get("status_code")
                identity_evidence = identity_observation
                directory_fields: dict[str, object] = {
                    **directory_evidence,
                    **directory_source,
                }
            else:
                allowed_hosts = []
                identity_evidence = None
                identity_method = None
                identity_source_url = None
                identity_source_final_url = None
                identity_source_status = None
                identity_observation = None
                directory_fields = {
                    "directory_package": None,
                    "directory_version": None,
                    "directory_source_url": None,
                    "directory_source_sha256": None,
                    "directory_record_sha256": None,
                    "matched_query": None,
                    "matched_company": None,
                    "matched_provider": None,
                    "matched_provider_key": None,
                    "matched_url": None,
                }
            evidence_url = candidate_url or url
            http_url = url if row["mapping_status"] == "verified" else evidence_url
            http_validation = outcomes[str(http_url)] if http_url else None
            if row["mapping_status"] == "unsupported":
                unsupported = unsupported_evidence(
                    str(row["canonical_company"]),
                    str(candidate_url) if candidate_url else None,
                    str(candidate.get("candidate_provider"))
                    if candidate.get("candidate_provider")
                    else None,
                    outcomes.get(str(candidate_url)) if candidate_url else None,
                )
                row["validation_notes"] = unsupported["reason"]
            else:
                unsupported = {
                    "unsupported_reason_category": None,
                    "evidence_method": "verified_source",
                    "evidence_status": "verified",
                }
            review_rows.append(
                {
                    "rank": row["rank"],
                    "sponsor_name": row["sponsor_name"],
                    "canonical_company": row["canonical_company"],
                    "total_approvals": row["total_approvals"],
                    "candidate_url": candidate_url,
                    "candidate_provider": candidate.get("candidate_provider"),
                    "candidate_provider_key": candidate.get("candidate_provider_key"),
                    "candidate_http_validation": outcomes.get(str(candidate_url))
                    if candidate_url
                    else None,
                    "career_url": url,
                    "provider": row["provider"],
                    "provider_key": row["provider_key"],
                    "http_validation": http_validation,
                    "unsupported_reason_category": unsupported.get(
                        "unsupported_reason_category"
                    ),
                    "evidence_method": unsupported["evidence_method"],
                    "evidence_status": unsupported["evidence_status"],
                    "identity_evidence": identity_evidence,
                    "identity_method": identity_method,
                    "identity_source_url": identity_source_url,
                    "identity_source_final_url": identity_source_final_url,
                    "identity_source_status": identity_source_status,
                    "identity_observation": identity_observation,
                    **directory_fields,
                    "observed_title": None,
                    "observed_company_tokens": None,
                    "observed_careers_links": None,
                    "selected_matching_link": None,
                    "allowed_final_hosts": allowed_hosts,
                    "decision": row["mapping_status"],
                    "decision_reason": row["validation_notes"],
                    "reviewed_at": "2026-08-12",
                }
            )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.review_output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output_rows, indent=2) + "\n", encoding="utf-8")
        args.review_output.write_text(json.dumps(review_rows, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {len(output_rows)} reviewed targets to {args.output}")
        print(f"wrote final review evidence to {args.review_output}")
        return 0

    output_rows: list[dict[str, object]] = []
    review_rows: list[dict[str, object]] = []
    with httpx.Client(
        follow_redirects=True,
        timeout=12,
        headers={"User-Agent": "JobIntelligence career-source review/1.0"},
    ) as client:
        for sponsor in sponsors:
            candidates = ats_candidates(sponsor["sponsor_name"])
            if args.freehire:
                candidates.extend(freehire_candidates(client, sponsor["sponsor_name"]))
            candidate = candidates[0] if candidates else {}
            career_url = candidate.get("career_url")
            validation = validate_http(client, str(career_url) if career_url else None)
            output_rows.append(
                {
                    "rank": int(sponsor["rank"]),
                    "sponsor_name": str(sponsor["sponsor_name"]),
                    "canonical_company": str(sponsor["sponsor_name"]),
                    "total_approvals": int(sponsor["total_approvals"]),
                    "career_url": career_url,
                    "provider": candidate.get("provider"),
                    "provider_key": candidate.get("provider_key"),
                    "mapping_status": "disabled",
                    "validation_notes": "candidate only; human official-source review required",
                }
            )
            review_rows.append(
                {
                    "rank": int(sponsor["rank"]),
                    "sponsor": str(sponsor["sponsor_name"]),
                    "candidate_url": career_url,
                    "candidate_provider": candidate.get("provider"),
                    "candidate_provider_key": candidate.get("provider_key"),
                    "evidence_source": candidate.get("evidence_source", "no directory match"),
                    "http_validation": validation,
                    "all_candidates": candidates,
                }
            )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.review_output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output_rows, indent=2) + "\n", encoding="utf-8")
    args.review_output.write_text(json.dumps(review_rows, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(output_rows)} disabled candidates to {args.output}")
    print(f"wrote review evidence to {args.review_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
