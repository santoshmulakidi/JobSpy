import runpy
import sys
from pathlib import Path
from types import ModuleType

import pytest

ENTRYPOINT = Path("deploy/hermes/top250_career_alerts.py")
PROJECT = "/home/ubuntu/JobSpy/job-intelligence"


def test_hermes_entrypoint_uses_project_and_scheduled_run():
    text = ENTRYPOINT.read_text(encoding="utf-8")

    assert text.startswith(f"#!{PROJECT}/.venv-career-alerts/bin/python\n")
    assert PROJECT in text
    assert '"scheduled-run"' in text
    assert "firecrawl" not in text.lower()


def test_hermes_entrypoint_calls_cli_without_agent_and_returns_exit_status(monkeypatch):
    observed = {}
    fake_cli = ModuleType("career_alerts.cli")

    def fake_main():
        observed["arguments"] = sys.argv[1:]
        observed["project_path"] = sys.path[0]
        return 17

    fake_cli.main = fake_main
    monkeypatch.setitem(sys.modules, "career_alerts.cli", fake_cli)
    monkeypatch.setattr(sys, "argv", [str(ENTRYPOINT), "ignored-input"])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(ENTRYPOINT), run_name="__main__")

    assert exit_info.value.code == 17
    assert observed == {
        "arguments": ["scheduled-run"],
        "project_path": PROJECT,
    }


def test_hermes_entrypoint_is_thin_and_has_no_deployment_or_secret_access():
    text = ENTRYPOINT.read_text(encoding="utf-8").lower()

    assert "subprocess" not in text
    assert "cron" not in text
    assert "smtp" not in text
    assert "email_config" not in text
    assert "hermes-agent" not in text
