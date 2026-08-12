from __future__ import annotations

import argparse
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

import httpx
from ats_scrapers import find_company

DEFAULT_OUTPUT = Path("data/top250_career_candidates.json")
DEFAULT_REVIEW = Path("data/top250_career_targets.review.json")
FORBIDDEN_HOSTS = {"indeed.com", "linkedin.com"}
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


def validate_http(client: httpx.Client, url: str | None) -> dict[str, object]:
    if not url:
        return {"ok": False, "status_code": None, "final_url": None, "error": "no candidate"}
    try:
        response = client.get(url)
        return {
            "ok": response.status_code < 500 and not is_aggregator(str(response.url)),
            "status_code": response.status_code,
            "final_url": str(response.url),
            "error": None,
        }
    except httpx.HTTPError as exc:
        return {"ok": False, "status_code": None, "final_url": None, "error": str(exc)}


def apply_review_decisions(
    sponsors: list[dict[str, object]], decisions_path: Path
) -> list[dict[str, object]]:
    """Materialize an explicitly human-reviewed registry; never infer approval."""
    decisions = json.loads(decisions_path.read_text(encoding="utf-8"))
    by_rank: dict[int, dict[str, object]] = {}
    for group in decisions.get("verified_groups", []):
        for rank in group["ranks"]:
            by_rank[int(rank)] = {
                "canonical_company": group["canonical_company"],
                "career_url": group["career_url"],
                "provider": group["provider"],
                "provider_key": group["provider_key"],
                "mapping_status": "verified",
                "validation_notes": group["validation_notes"],
            }
    for row in decisions.get("unsupported", []):
        by_rank[int(row["rank"])] = {
            "canonical_company": row.get("canonical_company"),
            "career_url": None,
            "provider": None,
            "provider_key": None,
            "mapping_status": "unsupported",
            "validation_notes": row["validation_notes"],
        }

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
        outcomes: dict[str, dict[str, object]] = {}
        with httpx.Client(
            follow_redirects=True,
            timeout=12,
            headers={"User-Agent": "JobIntelligence career-source review/1.0"},
        ) as client:
            urls = sorted({str(row["career_url"]) for row in output_rows if row["career_url"]})
            with ThreadPoolExecutor(max_workers=12) as executor:
                results = executor.map(lambda url: validate_http(client, url), urls)
                outcomes.update(zip(urls, results, strict=True))
        review_rows = [
            {
                "rank": row["rank"],
                "sponsor": row["sponsor_name"],
                "candidate_url": row["career_url"],
                "candidate_provider": row["provider"],
                "candidate_provider_key": row["provider_key"],
                "evidence_source": "human review of official company careers page or ATS tenant",
                "mapping_status": row["mapping_status"],
                "http_validation": outcomes.get(
                    str(row["career_url"]),
                    {
                        "ok": False,
                        "status_code": None,
                        "final_url": None,
                        "error": row["validation_notes"],
                    },
                ),
            }
            for row in output_rows
        ]
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
