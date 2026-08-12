import json

from career_alerts.registry import load_registry, validate_registry


def _row(**overrides):
    row = {
        "rank": 1,
        "sponsor_name": "Acme",
        "canonical_company": "Acme",
        "total_approvals": 10,
        "career_url": "https://jobs.acme.test",
        "provider": "custom",
        "provider_key": "acme",
        "mapping_status": "verified",
        "validation_notes": "official footer",
    }
    row.update(overrides)
    return row


def _load(tmp_path, rows):
    path = tmp_path / "targets.json"
    path.write_text(json.dumps(rows))
    return load_registry(path)


def test_registry_rejects_linkedin_and_paid_firecrawl(tmp_path):
    targets = _load(
        tmp_path,
        [_row(career_url="https://linkedin.com/company/acme", provider="html")],
    )

    errors = validate_registry(targets)

    assert any("official careers URL" in error for error in errors)


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
    assert validate_registry(targets) == []


def test_registry_rejects_unreviewed_and_inconsistent_rows(tmp_path):
    rows = [
        _row(mapping_status="disabled", validation_notes=""),
        _row(
            rank=1,
            sponsor_name="Acme",
            career_url=None,
            provider="custom",
            provider_key=None,
            mapping_status="verified",
        ),
    ]

    errors = validate_registry(_load(tmp_path, rows))

    assert any("duplicate sponsor" in error for error in errors)
    assert any("non-empty validation_notes" in error for error in errors)
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

    assert validate_registry(targets) == []


def test_registry_rejects_incomplete_top250_snapshot(tmp_path):
    targets = _load(
        tmp_path,
        [_row(rank=rank, sponsor_name=f"Acme {rank}") for rank in range(1, 4)],
    )

    errors = validate_registry(targets)

    assert any("ranks must be 1-250 exactly once" in error for error in errors)


def test_committed_registry_has_all_250_reviewed_sponsors():
    from pathlib import Path

    targets = load_registry(Path("data/top250_career_targets.json"))

    assert len(targets) == 250
    assert {target.rank for target in targets} == set(range(1, 251))
    assert all(target.mapping_status in {"verified", "unsupported"} for target in targets)
    assert validate_registry(targets) == []
