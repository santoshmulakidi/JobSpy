"""Command-line entry point for the Top-250 career-alert workflow."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from career_alerts.emailer import SmtpMailer
from career_alerts.registry import load_registry, validate_registry
from career_alerts.runner import CareerAlertRunner
from career_alerts.state import CareerAlertState

DEFAULT_REGISTRY = Path("/home/ubuntu/JobSpy/job-intelligence/data/top250_career_targets.json")
DEFAULT_STATE = Path("/home/ubuntu/.hermes/job-results/top250_career_alerts.sqlite3")
DEFAULT_EMAIL_CONFIG = Path("/home/ubuntu/.hermes/email_config.json")
DEFAULT_LOG = Path("/home/ubuntu/.hermes/logs/top250_career_alerts.log")


def main() -> int:
    arguments = sys.argv[1:]
    if "--now" in arguments:
        index = arguments.index("--now")
        if index + 1 < len(arguments):
            now_args = arguments[index : index + 2]
            arguments = [*now_args, *arguments[:index], *arguments[index + 2 :]]
    parser = argparse.ArgumentParser(prog="python -m career_alerts.cli")
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--email-config", type=Path, default=DEFAULT_EMAIL_CONFIG)
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG)
    parser.add_argument("--now")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("validate")
    collect = subparsers.add_parser("collect")
    collect.add_argument("--no-email", action="store_true")
    subparsers.add_parser("initial-send")
    subparsers.add_parser("scheduled-run")
    subparsers.add_parser("status")
    args = parser.parse_args(arguments)
    if args.now and os.getenv("CAREER_ALERTS_TESTING") != "1":
        parser.error("--now is available only when CAREER_ALERTS_TESTING=1")
    if args.command == "validate":
        errors = validate_registry(load_registry(args.registry))
        print(json.dumps({"registry_valid": not errors, "errors": errors}, sort_keys=True))
        return 2 if errors else 0
    state = CareerAlertState(args.state)
    if args.command == "status":
        print(json.dumps(state.status(), sort_keys=True))
        return 0
    now = _now(args.now)
    runner = CareerAlertRunner(
        registry_path=args.registry, state=state, mailer=SmtpMailer(config_path=args.email_config),
        clock=lambda: now,
    )
    try:
        summary = runner.collect(args.command != "collect" or not args.no_email, args.command == "initial-send")
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}, sort_keys=True))
        return 2
    print(json.dumps(summary.as_dict(), sort_keys=True))
    if summary.delivery_failed:
        return 4
    return 3 if summary.degraded_sources else 0


def _now(value: str | None) -> datetime:
    return datetime.fromisoformat(value).astimezone(UTC) if value else datetime.now(UTC)


if __name__ == "__main__":
    raise SystemExit(main())
