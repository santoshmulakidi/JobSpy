#!/home/ubuntu/JobSpy/job-intelligence/.venv-career-alerts/bin/python
"""Hermes no-agent entry point for the scheduled Top-250 career alerts."""

from __future__ import annotations

import sys
from importlib import import_module
from pathlib import Path

PROJECT = Path("/home/ubuntu/JobSpy/job-intelligence")
sys.path.insert(0, str(PROJECT))

main = import_module("career_alerts.cli").main


if __name__ == "__main__":
    sys.argv[1:] = ["scheduled-run"]
    raise SystemExit(main())
