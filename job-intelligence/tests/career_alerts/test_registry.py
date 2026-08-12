import json

import httpx
import pytest

from career_alerts.registry import load_registry, validate_registry
from tools.discover_career_sources import (
    apply_review_decisions,
    registrable_domain,
    validate_http,
)


def _row(**overrides):
    row = {
        "rank": 1,
        "sponsor_name": "Acme",
        "canonical_company": "Acme",
        "total_approvals": 10,
        "career_url": "https://jobs.ashbyhq.com/acme",
        "provider": "ashby",
        "provider_key": "acme",
        "mapping_status": "verified",
        "validation_notes": "official ATS tenant reviewed",
    }
    row.update(overrides)
    return row


def _load(tmp_path, rows):
    path = tmp_path / "targets.json"
    path.write_text(json.dumps(rows))
    return load_registry(path)


def test_registry_rejects_linkedin(tmp_path):
    targets = _load(
        tmp_path,
        [_row(career_url="https://linkedin.com/company/acme", provider="html")],
    )

    errors = validate_registry(targets, require_complete=False)

    assert any("official careers URL" in error for error in errors)


def test_registry_rejects_firecrawl_source_specifically(tmp_path):
    targets = _load(
        tmp_path,
        [_row(provider="firecrawl", provider_key="paid-crawl")],
    )

    errors = validate_registry(targets, require_complete=False)

    assert any("Firecrawl" in error for error in errors)


def test_registry_groups_shared_career_sources(tmp_path):
    rows = [
        _row(sponsor_name="Acme LLC"),
        _row(
            rank=2,
            sponsor_name="Acme Services",
            total_approvals=8,
            validation_notes="shared parent board",
        ),
    ]

    targets = _load(tmp_path, rows)

    assert targets[0].source_key == targets[1].source_key
    assert validate_registry(targets, require_complete=False) == []


def test_registry_rejects_unreviewed_and_inconsistent_rows(tmp_path):
    rows = [
        _row(mapping_status="disabled", validation_notes="unreviewed candidate"),
        _row(
            rank=1,
            sponsor_name="Acme",
            career_url=None,
            provider="ashby",
            provider_key=None,
            mapping_status="verified",
        ),
    ]

    errors = validate_registry(_load(tmp_path, rows), require_complete=False)

    assert any("duplicate sponsor" in error for error in errors)
    assert any("cannot be activated" in error for error in errors)
    assert any("HTTPS official careers URL" in error for error in errors)
    assert any("provider and provider_key" in error for error in errors)


def test_registry_accepts_documented_unsupported_target(tmp_path):
    targets = _load(
        tmp_path,
        [
            _row(
                career_url=None,
                provider=None,
                provider_key=None,
                mapping_status="unsupported",
                validation_notes="official board requires authenticated session",
            )
        ],
    )

    assert validate_registry(targets, require_complete=False) == []


def test_registry_rejects_unsupported_row_with_source_fields(tmp_path):
    targets = _load(
        tmp_path,
        [_row(mapping_status="unsupported", validation_notes="specific reviewed reason")],
    )

    errors = validate_registry(targets, require_complete=False)

    assert any("unsupported target must have null" in error for error in errors)


def test_registry_rejects_incomplete_top250_snapshot(tmp_path):
    targets = _load(
        tmp_path,
        [_row(rank=rank, sponsor_name=f"Acme {rank}") for rank in range(1, 4)],
    )

    errors = validate_registry(targets)

    assert any("ranks must be 1-250 exactly once" in error for error in errors)


def test_registry_rejects_arbitrary_unofficial_https_url(tmp_path):
    targets = _load(
        tmp_path,
        [_row(career_url="https://jobs.unrelated-example.test", provider="html")],
    )

    errors = validate_registry(targets, require_complete=False)

    assert any("approved official company domain" in error for error in errors)


def test_registry_rejects_provider_tenant_mismatch(tmp_path):
    targets = _load(
        tmp_path,
        [_row(career_url="https://job-boards.greenhouse.io/acme", provider="ashby")],
    )

    errors = validate_registry(targets, require_complete=False)

    assert any("does not match provider/key" in error for error in errors)


def test_registry_rejects_html_source_key_mismatch(tmp_path):
    targets = _load(
        tmp_path,
        [
            _row(
                career_url="https://www.amazon.jobs/en/",
                provider="html",
                provider_key="not-amazon",
            )
        ],
    )

    errors = validate_registry(targets, require_complete=False)

    assert any("approved official company source/key" in error for error in errors)


def test_registry_rejects_verified_404_evidence(tmp_path, monkeypatch):
    targets = _load(tmp_path, [_row()])
    evidence = ({
        "rank": 1,
        "sponsor_name": "Acme",
        "canonical_company": "Acme",
        "total_approvals": 10,
        "candidate_url": "https://jobs.ashbyhq.com/acme",
        "candidate_provider": "ashby",
        "candidate_provider_key": "acme",
        "career_url": "https://jobs.ashbyhq.com/acme",
        "provider": "ashby",
        "provider_key": "acme",
        "http_validation": {"status_code": 404, "http_success": False},
        "identity_method": "official_ats_directory",
        "identity_source_url": "https://jobs.ashbyhq.com/acme",
        "identity_source_final_url": "https://jobs.ashbyhq.com/acme",
        "identity_source_status": 200,
        "identity_observation": "ATS directory company name matched Acme and tenant key acme.",
        "allowed_final_hosts": [],
        "decision": "verified",
        "decision_reason": "official tenant",
        "reviewed_at": "2026-08-12",
    },)
    monkeypatch.setattr("career_alerts.registry._review_evidence", lambda: evidence)

    errors = validate_registry(targets, require_complete=False)

    assert any("HTTP 404 evidence cannot be verified" in error for error in errors)


def test_bot_block_override_requires_independent_identity(tmp_path, monkeypatch):
    targets = _load(tmp_path, [_row(validation_notes="official page blocked automation")])
    evidence = ({
        "rank": 1,
        "sponsor_name": "Acme",
        "canonical_company": "Acme",
        "total_approvals": 10,
        "candidate_url": "https://jobs.ashbyhq.com/acme",
        "candidate_provider": "ashby",
        "candidate_provider_key": "acme",
        "career_url": "https://jobs.ashbyhq.com/acme",
        "provider": "ashby",
        "provider_key": "acme",
        "http_validation": {"status_code": 403, "http_success": False},
        "identity_method": "selected_url_assertion",
        "identity_source_url": "https://jobs.ashbyhq.com/acme",
        "identity_source_final_url": "https://jobs.ashbyhq.com/acme",
        "identity_source_status": 403,
        "identity_observation": "This is official because the selected host says so.",
        "allowed_final_hosts": [],
        "decision": "verified",
        "decision_reason": "official page blocked automation",
        "reviewed_at": "2026-08-12",
    },)
    monkeypatch.setattr("career_alerts.registry._review_evidence", lambda: evidence)

    errors = validate_registry(targets, require_complete=False)

    assert any("independent identity evidence" in error for error in errors)


def test_semantic_evidence_cross_check_rejects_fabricated_fields(tmp_path, monkeypatch):
    targets = _load(tmp_path, [_row()])
    evidence = ({
        "rank": 1,
        "sponsor_name": "Acme",
        "canonical_company": "Acme",
        "total_approvals": 999,
        "candidate_url": "https://jobs.ashbyhq.com/acme",
        "candidate_provider": "ashby",
        "candidate_provider_key": "acme",
        "career_url": "https://jobs.ashbyhq.com/acme",
        "provider": "ashby",
        "provider_key": "acme",
        "http_validation": {
            "reachable": True,
            "http_success": True,
            "redirect_identity_ok": True,
            "ok": True,
            "status_code": 404,
            "final_url": "https://evil.example/jobs",
            "error": None,
        },
        "identity_method": "official_ats_directory",
        "identity_source_url": "https://storage.stapply.ai/jobhive/v1/manifest.json",
        "identity_source_final_url": "https://storage.stapply.ai/jobhive/v1/manifest.json",
        "identity_source_status": 200,
        "identity_observation": "Directory matched Acme to ashby/acme.",
        "allowed_final_hosts": [""],
        "decision": "verified",
        "decision_reason": "official tenant",
        "reviewed_at": 20260812,
    },)
    monkeypatch.setattr("career_alerts.registry._review_evidence", lambda: evidence)

    errors = validate_registry(targets, require_complete=False)

    assert any("total_approvals does not match" in error for error in errors)
    assert any("reviewed_at" in error for error in errors)
    assert any("allowed_final_hosts entries" in error for error in errors)
    assert any("HTTP 404 evidence cannot be verified" in error for error in errors)
    assert any("HTTP success flag is inconsistent" in error for error in errors)
    assert any("redirect identity flag is inconsistent" in error for error in errors)


def test_unrelated_html_with_self_authored_prose_is_rejected(tmp_path, monkeypatch):
    targets = _load(
        tmp_path,
        [_row(career_url="https://unrelated.example/jobs", provider="html")],
    )
    evidence = ({
        "rank": 1,
        "sponsor_name": "Acme",
        "canonical_company": "Acme",
        "total_approvals": 10,
        "career_url": "https://unrelated.example/jobs",
        "provider": "html",
        "provider_key": "acme",
        "http_validation": {"status_code": 200, "http_success": True},
        "identity_method": "official_company_careers_link",
        "identity_source_url": "https://unrelated.example/jobs",
        "identity_source_final_url": "https://unrelated.example/jobs",
        "identity_source_status": 200,
        "identity_observation": "Acme careers link claimed in prose.",
        "allowed_final_hosts": [],
        "decision": "verified",
        "decision_reason": "official source",
        "reviewed_at": "2026-08-12",
    },)
    monkeypatch.setattr("career_alerts.registry._review_evidence", lambda: evidence)

    errors = validate_registry(targets, require_complete=False)

    assert any("independent identity source" in error for error in errors)


def test_oracle_provider_key_must_match_site_path(tmp_path):
    targets = _load(
        tmp_path,
        [
            _row(
                career_url="https://tenant.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs",
                provider="oracle",
                provider_key="different-cx_9999",
            )
        ],
    )

    errors = validate_registry(targets, require_complete=False)

    assert any("does not match provider/key" in error for error in errors)


def test_public_suffix_comparison_distinguishes_unrelated_co_uk_domains():
    assert registrable_domain("careers.example.co.uk") == "example.co.uk"
    assert registrable_domain("jobs.evil.co.uk") == "evil.co.uk"
    assert registrable_domain("careers.example.co.uk") != registrable_domain("jobs.evil.co.uk")


def test_load_registry_does_not_coerce_null_required_string(tmp_path):
    path = tmp_path / "targets.json"
    path.write_text(json.dumps([_row(sponsor_name=None)]))

    with pytest.raises(ValueError, match="sponsor_name must be a non-empty string"):
        load_registry(path)


def test_load_registry_rejects_empty_required_notes(tmp_path):
    path = tmp_path / "targets.json"
    path.write_text(json.dumps([_row(validation_notes="")]))

    with pytest.raises(ValueError, match="validation_notes must be a non-empty string"):
        load_registry(path)


@pytest.mark.parametrize("status_code", [403, 404, 406])
def test_http_4xx_is_reachable_but_not_successful(status_code):
    def respond(request):
        return httpx.Response(status_code, request=request)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        outcome = validate_http(client, "https://jobs.ashbyhq.com/acme")

    assert outcome["reachable"] is True
    assert outcome["http_success"] is False
    assert outcome["ok"] is False


def test_http_unrelated_redirect_fails_identity_check():
    def respond(request):
        if request.url.host == "jobs.ashbyhq.com":
            return httpx.Response(302, headers={"location": "https://evil.example/jobs"})
        return httpx.Response(200)

    with httpx.Client(
        transport=httpx.MockTransport(respond), follow_redirects=True
    ) as client:
        outcome = validate_http(client, "https://jobs.ashbyhq.com/acme")

    assert outcome["reachable"] is True
    assert outcome["http_success"] is True
    assert outcome["redirect_identity_ok"] is False
    assert outcome["ok"] is False


def test_http_evidence_drops_query_strings():
    def respond(request):
        return httpx.Response(200, request=request)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        outcome = validate_http(client, "https://jobs.ashbyhq.com/acme?token=sensitive")

    assert outcome["final_url"] == "https://jobs.ashbyhq.com/acme"


def test_review_decisions_reject_duplicate_rank(tmp_path):
    decisions = {
        "verified_groups": [
            {
                "ranks": [1],
                "canonical_company": "Acme",
                "career_url": "https://jobs.ashbyhq.com/acme",
                "provider": "ashby",
                "provider_key": "acme",
                "validation_notes": "official ATS tenant reviewed",
            },
            {
                "ranks": [1],
                "canonical_company": "Acme duplicate",
                "career_url": "https://jobs.ashbyhq.com/acme",
                "provider": "ashby",
                "provider_key": "acme",
                "validation_notes": "duplicate decision",
            },
        ],
        "unsupported": [],
    }
    path = tmp_path / "decisions.json"
    path.write_text(json.dumps(decisions))

    with pytest.raises(ValueError, match="duplicate review decision for rank 1"):
        apply_review_decisions(
            [{"rank": 1, "sponsor_name": "ACME", "total_approvals": 10}], path
        )


def test_committed_registry_has_all_250_reviewed_sponsors():
    from pathlib import Path

    targets = load_registry(Path("data/top250_career_targets.json"))

    assert len(targets) == 250
    assert {target.rank for target in targets} == set(range(1, 251))
    assert all(target.mapping_status in {"verified", "unsupported"} for target in targets)
    assert validate_registry(targets) == []


def test_review_artifact_reproduces_registry_and_preserves_evidence():
    from pathlib import Path

    sponsors = json.loads(Path("data/top250_h1b_sponsors.json").read_text())
    expected = json.loads(Path("data/top250_career_targets.json").read_text())
    review_path = Path("data/top250_career_targets.review.json")
    evidence = json.loads(review_path.read_text())

    assert apply_review_decisions(sponsors, review_path) == expected
    assert len(evidence) == 250
    assert all(
        {
            "rank",
            "sponsor_name",
            "candidate_url",
            "candidate_provider",
            "candidate_provider_key",
            "career_url",
            "provider",
            "provider_key",
            "http_validation",
            "identity_evidence",
            "identity_method",
            "identity_source_url",
            "identity_source_final_url",
            "identity_source_status",
            "identity_observation",
            "decision",
            "decision_reason",
        }
        <= row.keys()
        for row in evidence
    )
    assert all(
        not row["http_validation"]["http_success"]
        for row in evidence
        if row["http_validation"]["status_code"] in {403, 404, 406}
    )
    rejected = next(row for row in evidence if row["rank"] == 201)
    assert rejected["decision"] == "unsupported"
    assert rejected["candidate_url"] == "https://careers.qualitestgroup.com/"
    assert rejected["career_url"] is None
    assert rejected["http_validation"]["status_code"] is not None
    assert not any(
        row["decision"] == "verified" and row["http_validation"]["status_code"] == 404
        for row in evidence
    )
    openai = next(row for row in evidence if row["rank"] == 72)
    assert (openai["provider"], openai["provider_key"]) == ("ashby", "openai")
    assert openai["career_url"] == "https://jobs.ashbyhq.com/openai"
