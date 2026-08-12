from __future__ import annotations

import argparse
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse, urlunsplit

import httpx
from ats_scrapers import find_company

from career_alerts.registry import provider_matches_url

DEFAULT_OUTPUT = Path("data/top250_career_candidates.json")
DEFAULT_REVIEW = Path("data/top250_career_targets.review.json")
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


def _identity_domain(host: str) -> str:
    parts = host.lower().rstrip(".").split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


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
                _identity_domain(original_host) == _identity_domain(final_host)
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
                add_decision(int(rank), {
                "canonical_company": group["canonical_company"],
                "career_url": career_url,
                "provider": provider,
                "provider_key": provider_key,
                "mapping_status": "verified",
                "validation_notes": group["validation_notes"],
                })
        for row in decisions.get("unsupported", []):
            add_decision(int(row["rank"]), {
                "canonical_company": row.get("canonical_company"),
                "career_url": None,
                "provider": None,
                "provider_key": None,
                "mapping_status": "unsupported",
                "validation_notes": row["validation_notes"],
            })
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
        output.append(
            {
                "rank": rank,
                "sponsor_name": str(sponsor["sponsor_name"]),
                "canonical_company": decision["canonical_company"]
                or str(sponsor["sponsor_name"]),
                "total_approvals": int(sponsor["total_approvals"]),
                "career_url": decision["career_url"],
                "provider": decision["provider"],
                "provider_key": decision["provider_key"],
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
        with httpx.Client(
            follow_redirects=True,
            timeout=12,
            headers={"User-Agent": "JobIntelligence career-source review/1.0"},
        ) as client:
            urls = {
                str(row["career_url"]) for row in output_rows if row["career_url"]
            }
            urls.update(
                str(metadata["candidate_url"])
                for metadata in candidate_metadata.values()
                if metadata.get("candidate_url")
            )
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
        review_rows = []
        for row in output_rows:
            url = row["career_url"]
            candidate = candidate_metadata.get(int(row["rank"]), {})
            candidate_url = candidate.get("candidate_url")
            host = urlparse(str(url)).hostname if url else None
            if row["mapping_status"] == "verified":
                allowed_hosts = sorted(redirect_allowlist.get(str(url), set()))
                identity_evidence = (
                    f"Human-reviewed official company careers domain: {host}"
                    if row["provider"] == "html"
                    else "Human-reviewed official ATS/first-party source: "
                    f"provider={row['provider']}; key={row['provider_key']}; host={host}"
                )
                if allowed_hosts:
                    identity_evidence += (
                        "; explicitly reviewed official redirect host(s): "
                        + ", ".join(allowed_hosts)
                    )
            else:
                allowed_hosts = []
                identity_evidence = None
            evidence_url = candidate_url or url
            http_validation = (
                outcomes[str(evidence_url)]
                if evidence_url
                else {
                    "reachable": False,
                    "http_success": False,
                    "redirect_identity_ok": False,
                    "ok": False,
                    "status_code": None,
                    "final_url": None,
                    "error": row["validation_notes"],
                }
            )
            review_rows.append(
                {
                    "rank": row["rank"],
                    "sponsor_name": row["sponsor_name"],
                    "canonical_company": row["canonical_company"],
                    "total_approvals": row["total_approvals"],
                    "candidate_url": candidate_url,
                    "candidate_provider": candidate.get("candidate_provider"),
                    "candidate_provider_key": candidate.get("candidate_provider_key"),
                    "career_url": url,
                    "provider": row["provider"],
                    "provider_key": row["provider_key"],
                    "http_validation": http_validation,
                    "identity_evidence": identity_evidence,
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
