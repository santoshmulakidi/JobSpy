from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TARGETS_PATH = PROJECT_ROOT / "data" / "company_targets.json"
H1B_TARGETS_PATH = PROJECT_ROOT / "data" / "h1b_company_targets.json"


@lru_cache(maxsize=1)
def load_company_targets() -> list[dict[str, Any]]:
    if not TARGETS_PATH.exists():
        return []
    return json.loads(TARGETS_PATH.read_text())


@lru_cache(maxsize=1)
def load_h1b_company_targets() -> list[dict[str, Any]]:
    if not H1B_TARGETS_PATH.exists():
        return []
    return json.loads(H1B_TARGETS_PATH.read_text())


def select_company_targets(limit: int | None, target_set: str = "default") -> list[dict[str, Any]]:
    targets = load_h1b_company_targets() if target_set == "h1b" else load_company_targets()
    if limit is None:
        return targets
    return targets[:limit]


def company_search_fragment(company: str) -> str:
    fragment = company.replace("/", " ")
    fragment = re.sub(r"\([^)]*\)", " ", fragment)
    fragment = re.sub(r"[^A-Za-z0-9&.+# -]+", " ", fragment)
    fragment = re.sub(r"\s+", " ", fragment).strip()
    return fragment or company
