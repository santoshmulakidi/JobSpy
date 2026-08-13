import json

import pytest

from career_alerts import cli


def test_validate_uses_default_registry_and_prints_json(monkeypatch, capsys):
    monkeypatch.setattr(cli, "load_registry", lambda _path: [])
    monkeypatch.setattr(cli, "validate_registry", lambda _targets: [])
    monkeypatch.setattr("sys.argv", ["career-alerts", "validate"])

    assert cli.main() == 0
    assert json.loads(capsys.readouterr().out)["registry_valid"] is True


def test_now_requires_testing_environment(monkeypatch, capsys):
    monkeypatch.delenv("CAREER_ALERTS_TESTING", raising=False)
    monkeypatch.setattr("sys.argv", ["career-alerts", "collect", "--no-email", "--now", "2026-08-12T13:00:00Z"])

    with pytest.raises(SystemExit) as exc_info:
        cli.main()
    assert exc_info.value.code == 2
    assert "--now" in capsys.readouterr().err


@pytest.mark.parametrize("command", ["validate", "status"])
def test_validate_and_status_have_complete_summary(monkeypatch, capsys, tmp_path, command):
    monkeypatch.setattr(cli, "load_registry", lambda _path: [])
    monkeypatch.setattr(cli, "validate_registry", lambda _targets: [])
    monkeypatch.setattr("sys.argv", ["career-alerts", "--state", str(tmp_path / "state.sqlite3"), command])

    assert cli.main() == 0
    payload = json.loads(capsys.readouterr().out)
    assert {
        "attempted_sources", "succeeded_sources", "degraded_sources", "failed_sources",
        "fetched_jobs", "matched_jobs", "new_jobs", "duplicate_jobs", "emailed_jobs",
        "delivery_counts", "delivery_failed", "checkpoint",
    } <= payload.keys()
