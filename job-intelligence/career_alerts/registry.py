from __future__ import annotations

import json
from collections import Counter
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import tldextract

from career_alerts.types import SponsorTarget

_MAPPING_STATUSES = {"verified", "unsupported", "disabled"}
_FORBIDDEN_HOSTS = {
    "careerbuilder.com",
    "glassdoor.com",
    "indeed.com",
    "join.com",
    "linkedin.com",
    "monster.com",
    "ziprecruiter.com",
}
_FORBIDDEN_TERMS = ("firecrawl",)
_PROVIDERS = {
    "adp",
    "ashby",
    "avature",
    "bytedance",
    "eightfold",
    "google",
    "greenhouse",
    "html",
    "icims",
    "lever",
    "oracle",
    "paycom",
    "smartrecruiters",
    "successfactors",
    "uber",
    "workable",
    "workday",
}
_REVIEW_PATH = Path(__file__).resolve().parents[1] / "data" / "top250_career_targets.review.json"
_TLD_EXTRACT = tldextract.TLDExtract(suffix_list_urls=())
_INDEPENDENT_IDENTITY_METHODS = {
    "official_company_careers_link",
    "official_ats_directory",
    "official_parent_careers_link",
}


def _required_text(row: dict[str, object], field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    return value


def _optional_text(row: dict[str, object], field: str) -> str | None:
    value = row.get(field)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be null or a non-empty string")
    return value


def _required_int(row: dict[str, object], field: str) -> int:
    value = row.get(field)
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{field} must be an integer")
    return value


def load_registry(path: Path) -> list[SponsorTarget]:
    """Load registry JSON with strict types into immutable target records."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise TypeError("registry root must be a JSON array")

    targets: list[SponsorTarget] = []
    for index, row in enumerate(payload, start=1):
        if not isinstance(row, dict):
            raise TypeError(f"registry row {index} must be an object")
        try:
            target = SponsorTarget(
                rank=_required_int(row, "rank"),
                sponsor_name=_required_text(row, "sponsor_name"),
                canonical_company=_required_text(row, "canonical_company"),
                total_approvals=_required_int(row, "total_approvals"),
                career_url=_optional_text(row, "career_url"),
                provider=_optional_text(row, "provider"),
                provider_key=_optional_text(row, "provider_key"),
                mapping_status=_required_text(row, "mapping_status"),  # type: ignore[arg-type]
                validation_notes=_required_text(row, "validation_notes"),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"invalid registry row {index}: {exc}") from exc
        targets.append(target)
    return targets


def _host_matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith(f".{domain}")


def _registrable_domain(host: str) -> str:
    extracted = _TLD_EXTRACT(host.lower().rstrip("."))
    return extracted.top_domain_under_public_suffix or host.lower().rstrip(".")


def _is_forbidden_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(_host_matches(host, forbidden) for forbidden in _FORBIDDEN_HOSTS)


def _first_path_segment(url: str) -> str:
    return next((part for part in urlparse(url).path.split("/") if part), "")


def provider_matches_url(provider: str, provider_key: str, url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    key = provider_key.casefold()
    first_path = _first_path_segment(url).casefold()

    if provider == "ashby":
        return host == "jobs.ashbyhq.com" and first_path == key
    if provider == "greenhouse":
        return host in {"boards.greenhouse.io", "job-boards.greenhouse.io"} and first_path == key
    if provider == "lever":
        return host == "jobs.lever.co" and first_path == key
    if provider == "smartrecruiters":
        return host == "careers.smartrecruiters.com" and first_path == key
    if provider == "workable":
        return host == "apply.workable.com" and first_path == key
    if provider == "avature":
        return host == f"{key}.avature.net"
    if provider == "eightfold":
        return host == f"{key}.eightfold.ai"
    if provider == "icims":
        return _host_matches(host, "icims.com") and key.replace("https://", "") in host
    if provider == "workday":
        if not _host_matches(host, "myworkdayjobs.com") or "/" not in provider_key:
            return False
        tenant, board = provider_key.casefold().split("/", 1)
        return host.split(".", 1)[0] == tenant and first_path == board
    if provider == "adp":
        return host == "workforcenow.adp.com" and key in parse_qs(parsed.query).get("cid", [])
    if provider == "successfactors":
        return any(
            _host_matches(host, domain)
            for domain in ("successfactors.com", "successfactors.eu", "sapsf.com", "sapsf.eu")
        ) and key in parsed.query.casefold()
    if provider == "paycom":
        return _host_matches(host, "paycomonline.net") and key in url.casefold()
    if provider == "google":
        return _host_matches(host, "google.com") and key == "google"
    if provider == "bytedance":
        return host == "jobs.bytedance.com" and key == "bytedance"
    if provider == "uber":
        return _host_matches(host, "uber.com") and key == "uber"
    if provider == "oracle":
        if not any(_host_matches(host, item) for item in ("oracle.com", "oraclecloud.com")):
            return False
        path = parsed.path.casefold()
        key_parts = key.rsplit("-", 1)
        if len(key_parts) == 2 and key_parts[1].startswith("cx_"):
            return f"/sites/{key_parts[1]}" in path
        if host == "careers.oracle.com":
            return key == "oracle" and "/sites/jobsearch" in path
        return False
    return False


@lru_cache(maxsize=1)
def _review_evidence() -> tuple[dict[str, object], ...]:
    if not _REVIEW_PATH.exists():
        return ()
    payload = json.loads(_REVIEW_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        return ()
    return tuple(row for row in payload if isinstance(row, dict))


def _approved_html_sources() -> tuple[set[str], set[tuple[str, str]]]:
    hosts: set[str] = set()
    sources: set[tuple[str, str]] = set()
    for row in _review_evidence():
        if row.get("decision") != "verified" or row.get("provider") != "html":
            continue
        url = row.get("career_url")
        provider_key = row.get("provider_key")
        evidence = row.get("identity_evidence")
        if (
            isinstance(url, str)
            and isinstance(provider_key, str)
            and isinstance(evidence, str)
            and evidence.strip()
        ):
            host = urlparse(url).hostname
            if host:
                hosts.add(host.lower())
                sources.add((url, provider_key))
    return hosts, sources


def _evidence_errors(targets: list[SponsorTarget]) -> list[str]:
    evidence = _review_evidence()
    counts = Counter(row.get("rank") for row in evidence)
    by_rank = {row.get("rank"): row for row in evidence}
    errors: list[str] = []
    target_ranks = {target.rank for target in targets}
    complete_expected = set(range(1, 251))
    if (
        len(evidence) == 250
        and set(by_rank) == complete_expected
        and all(count == 1 for count in counts.values())
    ):
        pass
    elif set(by_rank) != target_ranks or any(count != 1 for count in counts.values()):
        errors.append("review evidence must contain ranks 1-250 exactly once")
        return errors

    for target in targets:
        row = by_rank.get(target.rank)
        label = f"rank {target.rank} ({target.sponsor_name})"
        if not row:
            errors.append(f"{label}: missing review evidence")
            continue
        comparisons = {
            "sponsor_name": target.sponsor_name,
            "canonical_company": target.canonical_company,
            "total_approvals": target.total_approvals,
            "career_url": target.career_url,
            "provider": target.provider,
            "provider_key": target.provider_key,
            "decision": target.mapping_status,
            "decision_reason": target.validation_notes,
        }
        for field, expected in comparisons.items():
            if row.get(field) != expected:
                errors.append(f"{label}: review evidence {field} does not match registry")
        if not isinstance(row.get("reviewed_at"), str) or row.get("reviewed_at") != "2026-08-12":
            errors.append(f"{label}: reviewed_at must be the ISO review date 2026-08-12")
        if not isinstance(row.get("allowed_final_hosts"), list):
            errors.append(f"{label}: allowed_final_hosts must be a list")
            allowed_final_hosts: list[str] = []
        else:
            allowed_final_hosts = row["allowed_final_hosts"]  # type: ignore[assignment]
            if not all(isinstance(host, str) and host.strip() for host in allowed_final_hosts):
                errors.append(f"{label}: allowed_final_hosts entries must be non-empty strings")
        if target.mapping_status == "verified":
            method = row.get("identity_method")
            source_url = row.get("identity_source_url")
            source_final_url = row.get("identity_source_final_url")
            source_status = row.get("identity_source_status")
            observation = row.get("identity_observation")
            if method not in _INDEPENDENT_IDENTITY_METHODS:
                errors.append(f"{label}: verified target requires independent identity evidence")
            if not all(isinstance(value, str) and value.strip() for value in (
                source_url,
                source_final_url,
                observation,
            )) or not isinstance(source_status, int):
                errors.append(f"{label}: identity evidence fields are incomplete")
            elif not 200 <= source_status < 400:
                errors.append(f"{label}: independent identity source was not HTTP-successful")
            if isinstance(observation, str) and target.canonical_company.casefold() not in observation.casefold():
                errors.append(f"{label}: identity observation does not name the canonical company")
            if isinstance(source_url, str) and source_url == target.career_url:
                errors.append(f"{label}: identity evidence requires an independent identity source")
            if isinstance(source_url, str) and method == "official_company_careers_link":
                source_host = urlparse(source_url).hostname or ""
                target_host = urlparse(target.career_url or "").hostname or ""
                if not source_host or _registrable_domain(source_host) != _registrable_domain(
                    target_host
                ):
                    errors.append(f"{label}: independent identity source does not match company domain")
            http_validation = row.get("http_validation")
            if not isinstance(http_validation, dict):
                errors.append(f"{label}: missing structured HTTP validation evidence")
            else:
                status = http_validation.get("status_code")
                required_http_fields = {
                    "reachable",
                    "http_success",
                    "redirect_identity_ok",
                    "ok",
                    "status_code",
                    "final_url",
                    "error",
                }
                if not required_http_fields <= http_validation.keys():
                    errors.append(f"{label}: HTTP validation evidence fields are incomplete")
                if status == 404:
                    errors.append(f"{label}: HTTP 404 evidence cannot be verified")
                elif isinstance(status, int) and not 200 <= status < 400 and status not in {
                    403,
                    406,
                }:
                    errors.append(f"{label}: HTTP {status} evidence cannot be verified")
                if http_validation.get("http_success") != (
                    isinstance(status, int) and 200 <= status < 400
                ):
                    errors.append(f"{label}: HTTP success flag is inconsistent with status")
                final_url = http_validation.get("final_url")
                if isinstance(final_url, str) and target.career_url:
                    target_host = urlparse(target.career_url).hostname or ""
                    final_host = urlparse(final_url).hostname or ""
                    same_domain = _registrable_domain(target_host) == _registrable_domain(final_host)
                    allowed_redirect = final_host.lower() in {
                        host.lower() for host in allowed_final_hosts if isinstance(host, str)
                    }
                    expected_identity_ok = bool(final_host and (same_domain or allowed_redirect))
                    if http_validation.get("redirect_identity_ok") != expected_identity_ok:
                        errors.append(f"{label}: redirect identity flag is inconsistent with evidence")
                if status in {403, 406} and (
                    method not in _INDEPENDENT_IDENTITY_METHODS
                    or "block" not in target.validation_notes.casefold()
                ):
                    errors.append(
                        f"{label}: bot-block override requires independent identity evidence "
                        "and a specific blocking note"
                    )
        candidate_fields = (
            row.get("candidate_url"),
            row.get("candidate_provider"),
            row.get("candidate_provider_key"),
        )
        if any(value is not None for value in candidate_fields) and not all(
            isinstance(value, str) and value for value in candidate_fields
        ):
            errors.append(f"{label}: candidate URL/provider/key must be complete or all null")
        elif (
            target.mapping_status == "verified"
            and isinstance(row.get("candidate_provider"), str)
            and row.get("candidate_provider") != "html"
            and isinstance(row.get("candidate_provider_key"), str)
        ):
            candidate_provider = str(row["candidate_provider"])
            candidate_key = str(row["candidate_provider_key"])
            if provider_matches_url(
                candidate_provider, candidate_key, target.career_url or ""
            ) and (target.provider, target.provider_key) != (candidate_provider, candidate_key):
                errors.append(f"{label}: supported direct ATS candidate must remain direct")
    return errors


def validate_registry(
    targets: list[SponsorTarget], *, require_complete: bool = True
) -> list[str]:
    """Return all registry errors; strict Top-250 validation is the production default."""
    errors: list[str] = []
    rank_counts = Counter(target.rank for target in targets)
    sponsor_counts = Counter(target.sponsor_name.strip().casefold() for target in targets)

    if require_complete:
        actual_ranks = set(rank_counts)
        expected_ranks = set(range(1, 251))
        if actual_ranks != expected_ranks or len(targets) != 250:
            missing = sorted(expected_ranks - actual_ranks)
            extra = sorted(actual_ranks - expected_ranks)
            errors.append(f"ranks must be 1-250 exactly once; missing={missing}, extra={extra}")
        elif not errors:
            errors.extend(_evidence_errors(targets))
    else:
        evidence_by_rank = {row.get("rank"): row for row in _review_evidence()}
        if all(
            target.rank in evidence_by_rank
            and evidence_by_rank[target.rank].get("sponsor_name") == target.sponsor_name
            for target in targets
        ):
            errors.extend(_evidence_errors(targets))

    approved_html_hosts, approved_html_sources = _approved_html_sources()
    for target in targets:
        label = f"rank {target.rank} ({target.sponsor_name})"
        if not 1 <= target.rank <= 250:
            errors.append(f"{label}: rank must be between 1 and 250")
        if rank_counts[target.rank] > 1:
            errors.append(f"{label}: duplicate rank")
        if sponsor_counts[target.sponsor_name.strip().casefold()] > 1:
            errors.append(f"{label}: duplicate sponsor row")
        if target.total_approvals < 0:
            errors.append(f"{label}: total_approvals cannot be negative")
        if target.mapping_status not in _MAPPING_STATUSES:
            errors.append(f"{label}: invalid mapping_status {target.mapping_status!r}")
        elif target.mapping_status == "disabled":
            errors.append(f"{label}: disabled candidate cannot be activated without human review")

        has_provider = bool(target.provider)
        has_provider_key = bool(target.provider_key)
        if has_provider != has_provider_key:
            errors.append(f"{label}: provider and provider_key must both be set or both be null")

        if target.mapping_status == "unsupported":
            if target.career_url is not None or target.provider is not None or target.provider_key is not None:
                errors.append(
                    f"{label}: unsupported target must have null career_url, provider, and provider_key"
                )
            if len(target.validation_notes.strip()) < 20:
                errors.append(f"{label}: unsupported target requires a specific reviewed reason")

        if target.mapping_status == "verified":
            parsed = urlparse(target.career_url or "")
            host = (parsed.hostname or "").lower()
            if parsed.scheme != "https" or not host:
                errors.append(f"{label}: verified target requires an HTTPS official careers URL")
            if not has_provider or not has_provider_key:
                errors.append(f"{label}: verified target requires provider and provider_key")
            elif target.provider not in _PROVIDERS:
                errors.append(f"{label}: provider {target.provider!r} is not allowed")
            elif target.provider == "html":
                if host not in approved_html_hosts:
                    errors.append(f"{label}: URL host is not an approved official company domain")
                elif (target.career_url, target.provider_key) not in approved_html_sources:
                    errors.append(f"{label}: URL/key is not an approved official company source/key")
            elif target.career_url and not provider_matches_url(
                target.provider, target.provider_key, target.career_url
            ):
                errors.append(f"{label}: career URL does not match provider/key tenant identity")

        searchable = " ".join(
            value for value in (target.career_url, target.provider, target.provider_key) if value
        ).lower()
        if target.career_url and _is_forbidden_url(target.career_url):
            errors.append(f"{label}: career_url must be an official careers URL, not an aggregator")
        if any(term in searchable for term in _FORBIDDEN_TERMS):
            errors.append(f"{label}: paid Firecrawl sources are forbidden")

    return errors
