from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import sqlite3

from sqlalchemy.engine import make_url


def backup_sqlite_database(
    database_url: str,
    *,
    backup_dir: Path | None = None,
    now: datetime | None = None,
    cwd: Path | None = None,
) -> Path | None:
    """Create a consistent SQLite backup before destructive lifecycle cleanup.

    Returns None for non-SQLite databases, in-memory SQLite, or missing DB files.
    """
    url = make_url(database_url)
    if not url.drivername.startswith("sqlite"):
        return None

    database = url.database
    if not database or database == ":memory:":
        return None

    base_dir = cwd or Path.cwd()
    source_path = Path(database)
    if not source_path.is_absolute():
        source_path = (base_dir / source_path).resolve()
    if not source_path.exists():
        return None

    created_at = now or datetime.now(UTC)
    destination_dir = backup_dir or (source_path.parent / "backups")
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination_path = destination_dir / f"{source_path.stem}_{created_at:%Y%m%d_%H%M%S}.db"

    with sqlite3.connect(source_path) as source, sqlite3.connect(destination_path) as destination:
        source.backup(destination)

    return destination_path
