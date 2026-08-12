from __future__ import annotations

import argparse
from pathlib import Path

from career_alerts.registry import load_registry, validate_registry


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m career_alerts.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate", help="validate a career-source registry")
    validate.add_argument("--registry", type=Path, required=True)
    args = parser.parse_args()

    targets = load_registry(args.registry)
    errors = validate_registry(targets)
    verified = sum(target.mapping_status == "verified" for target in targets)
    unsupported = sum(target.mapping_status == "unsupported" for target in targets)
    print(
        f"{len(targets)} sponsors: {verified} verified, "
        f"{unsupported} unsupported, {len(errors)} invalid"
    )
    for error in errors:
        print(f"- {error}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
