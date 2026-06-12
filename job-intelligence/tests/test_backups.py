from __future__ import annotations

from datetime import UTC, datetime
import sqlite3

from storage.backups import backup_sqlite_database


def test_backup_sqlite_database_creates_timestamped_snapshot(tmp_path):
    database_path = tmp_path / "job_intelligence.db"
    with sqlite3.connect(database_path) as connection:
        connection.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT)")
        connection.execute("INSERT INTO jobs (title) VALUES ('Senior .NET Developer')")

    backup_path = backup_sqlite_database(
        "sqlite:///job_intelligence.db",
        cwd=tmp_path,
        now=datetime(2026, 6, 12, 23, 15, 0, tzinfo=UTC),
    )

    assert backup_path == tmp_path / "backups" / "job_intelligence_20260612_231500.db"
    with sqlite3.connect(backup_path) as backup:
        rows = backup.execute("SELECT title FROM jobs").fetchall()
    assert rows == [("Senior .NET Developer",)]


def test_backup_sqlite_database_skips_non_sqlite_urls(tmp_path):
    backup_path = backup_sqlite_database(
        "postgresql+psycopg://jobintel:jobintel@localhost:5432/jobintel",
        cwd=tmp_path,
    )

    assert backup_path is None
    assert not (tmp_path / "backups").exists()


def test_backup_sqlite_database_skips_missing_files(tmp_path):
    backup_path = backup_sqlite_database("sqlite:///missing.db", cwd=tmp_path)

    assert backup_path is None
    assert not (tmp_path / "backups").exists()
