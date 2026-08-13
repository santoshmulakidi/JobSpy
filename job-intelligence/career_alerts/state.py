"""SQLite-backed durable state for career-alert collection and delivery."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from career_alerts.providers import FetchResult
from career_alerts.types import CareerJob, MatchedJob, Stream

_FAILURE_THRESHOLD = 3


class CareerAlertState:
    """Persist discovered jobs, stream delivery status, and source health."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            self._create_schema(connection)

    def upsert_matches(self, matches: list[MatchedJob], observed_at: datetime) -> None:
        observed = _timestamp(observed_at)
        with self._transaction() as connection:
            for match in matches:
                job = match.job
                job_key = _job_key(job)
                connection.execute(
                    """
                    INSERT INTO jobs (
                        job_key, source_key, provider, provider_job_id, company, sponsor_names,
                        title, location, description, apply_url, posted_at, is_remote, first_seen_at, observed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(job_key) DO UPDATE SET
                        source_key = excluded.source_key,
                        company = excluded.company,
                        sponsor_names = excluded.sponsor_names,
                        title = excluded.title,
                        location = excluded.location,
                        description = excluded.description,
                        apply_url = excluded.apply_url,
                        posted_at = excluded.posted_at,
                        is_remote = excluded.is_remote,
                        observed_at = excluded.observed_at
                    """,
                    (
                        job_key,
                        job.source_key,
                        job.provider,
                        job.provider_job_id,
                        job.company,
                        json.dumps(job.sponsor_names),
                        job.title,
                        job.location,
                        job.description,
                        _stored_url(job.apply_url),
                        _timestamp(job.posted_at) if job.posted_at else None,
                        int(job.is_remote),
                        observed,
                        observed,
                    ),
                )
                _reconcile_http_identity(connection, job, job_key)
                for stream in match.streams:
                    connection.execute(
                        """
                        INSERT INTO job_streams (job_key, stream, location_bucket, observed_at)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(job_key, stream) DO UPDATE SET
                            location_bucket = excluded.location_bucket,
                            observed_at = excluded.observed_at
                        """,
                        (job_key, stream, match.location_bucket, observed),
                    )

    def pending(self, stream: Stream) -> list[tuple[str, MatchedJob, datetime]]:
        return self._stream_jobs(stream, include_delivered=False)

    def stream_jobs(
        self, stream: Stream, *, include_delivered: bool = False
    ) -> list[tuple[str, MatchedJob, datetime]]:
        """Return jobs in one stream with their immutable first-seen time."""
        return self._stream_jobs(stream, include_delivered=include_delivered)

    def _stream_jobs(
        self, stream: Stream, *, include_delivered: bool
    ) -> list[tuple[str, MatchedJob, datetime]]:
        pending_clause = "" if include_delivered else "AND job_streams.delivered_at IS NULL"
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT jobs.*, job_streams.location_bucket
                FROM job_streams
                JOIN jobs USING (job_key)
                WHERE job_streams.stream = ? {pending_clause}
                ORDER BY jobs.first_seen_at, jobs.job_key
                """,
                (stream,),
            ).fetchall()
        return [
            (row["job_key"], _matched_job(row, stream), datetime.fromisoformat(row["first_seen_at"]))
            for row in rows
        ]

    def record_delivery(
        self,
        stream: Stream,
        job_keys: list[str],
        delivered_at: datetime,
        *,
        success: bool = True,
    ) -> None:
        timestamp = _timestamp(delivered_at)
        with self._transaction() as connection:
            run = connection.execute(
                "INSERT INTO delivery_runs (stream, delivered_at, success) VALUES (?, ?, ?)",
                (stream, timestamp, int(success)),
            )
            delivery_run_id = run.lastrowid
            for job_key in job_keys:
                connection.execute(
                    "INSERT INTO delivery_jobs (delivery_run_id, job_key) VALUES (?, ?)",
                    (delivery_run_id, job_key),
                )
            if success and job_keys:
                placeholders = ", ".join("?" for _ in job_keys)
                connection.execute(
                    f"""
                    UPDATE job_streams
                    SET delivered_at = ?
                    WHERE stream = ? AND job_key IN ({placeholders})
                    """,
                    (timestamp, stream, *job_keys),
                )

    def record_source_result(self, result: FetchResult, observed_at: datetime) -> None:
        timestamp = _timestamp(observed_at)
        failed = result.error_code not in {None, "no_open_jobs"}
        with self._transaction() as connection:
            connection.execute(
                """
                INSERT INTO source_runs (
                    source_key, observed_at, elapsed_ms, attempt_count, error_code
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    result.source_key,
                    timestamp,
                    result.elapsed_ms,
                    result.attempt_count,
                    result.error_code,
                ),
            )
            connection.execute(
                """
                INSERT INTO source_health (
                    source_key, consecutive_failures, degraded, last_error_code, observed_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(source_key) DO UPDATE SET
                    consecutive_failures = CASE
                        WHEN ? THEN source_health.consecutive_failures + 1 ELSE 0 END,
                    degraded = CASE
                        WHEN ? AND source_health.consecutive_failures + 1 >= ? THEN 1 ELSE 0 END,
                    last_error_code = CASE WHEN ? THEN excluded.last_error_code ELSE NULL END,
                    observed_at = excluded.observed_at
                """,
                (
                    result.source_key,
                    int(failed),
                    int(failed and _FAILURE_THRESHOLD <= 1),
                    result.error_code,
                    timestamp,
                    int(failed),
                    int(failed),
                    _FAILURE_THRESHOLD,
                    int(failed),
                ),
            )

    def status(self) -> dict[str, object]:
        with self._connect() as connection:
            sources = connection.execute(
                "SELECT source_key, consecutive_failures, degraded, last_error_code FROM source_health"
            ).fetchall()
        return {
            "sources": {
                row["source_key"]: {
                    "consecutive_failures": row["consecutive_failures"],
                    "degraded": bool(row["degraded"]),
                    "last_error_code": row["last_error_code"],
                }
                for row in sources
            }
        }

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 10000")
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _transaction(self):
        connection = self._connect()
        connection.execute("BEGIN IMMEDIATE")
        return _Transaction(connection)

    @staticmethod
    def _create_schema(connection: sqlite3.Connection) -> None:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                job_key TEXT PRIMARY KEY, source_key TEXT NOT NULL, provider TEXT NOT NULL,
                provider_job_id TEXT NOT NULL, company TEXT NOT NULL, sponsor_names TEXT NOT NULL,
                title TEXT NOT NULL, location TEXT NOT NULL, description TEXT NOT NULL,
                apply_url TEXT NOT NULL, posted_at TEXT, is_remote INTEGER NOT NULL,
                first_seen_at TEXT NOT NULL, observed_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS job_streams (
                job_key TEXT NOT NULL REFERENCES jobs(job_key), stream TEXT NOT NULL,
                location_bucket TEXT NOT NULL, observed_at TEXT NOT NULL, delivered_at TEXT,
                PRIMARY KEY (job_key, stream)
            );
            CREATE TABLE IF NOT EXISTS source_health (
                source_key TEXT PRIMARY KEY, consecutive_failures INTEGER NOT NULL,
                degraded INTEGER NOT NULL, last_error_code TEXT, observed_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS source_runs (
                id INTEGER PRIMARY KEY, source_key TEXT NOT NULL, observed_at TEXT NOT NULL,
                elapsed_ms INTEGER NOT NULL, attempt_count INTEGER NOT NULL, error_code TEXT
            );
            CREATE TABLE IF NOT EXISTS delivery_runs (
                id INTEGER PRIMARY KEY, stream TEXT NOT NULL, delivered_at TEXT NOT NULL,
                success INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS delivery_jobs (
                delivery_run_id INTEGER NOT NULL REFERENCES delivery_runs(id),
                job_key TEXT NOT NULL REFERENCES jobs(job_key),
                PRIMARY KEY (delivery_run_id, job_key)
            );
            """
        )
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(jobs)").fetchall()
        }
        if "first_seen_at" not in columns:
            connection.execute("ALTER TABLE jobs ADD COLUMN first_seen_at TEXT")
            connection.execute(
                "UPDATE jobs SET first_seen_at = observed_at WHERE first_seen_at IS NULL"
            )


class _Transaction:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection

    def __enter__(self) -> sqlite3.Connection:
        return self.connection

    def __exit__(self, exc_type, exc, traceback) -> None:
        if exc_type is None:
            self.connection.commit()
        else:
            self.connection.rollback()
        self.connection.close()


def _job_key(job: CareerJob) -> str:
    canonical_url = _canonical_url(job.apply_url)
    if job.provider_job_id:
        identity = f"{job.provider}\x1f{job.provider_job_id}\x1f{canonical_url}"
    else:
        identity = "\x1f".join(
            (
                job.company.casefold().strip(),
                " ".join(job.title.casefold().split()),
                " ".join(job.location.casefold().split()),
                canonical_url,
            )
        )
    return hashlib.sha256(identity.encode()).hexdigest()


def _canonical_url(url: str) -> str:
    parsed = urlsplit(url.strip())
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, "", ""))


def _stored_url(url: str) -> str:
    """Normalize storage while preserving query text and its ordering."""
    parsed = urlsplit(url.strip())
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit(
        (parsed.scheme.lower(), parsed.netloc.lower(), path, parsed.query, "")
    )


def _reconciliation_url(url: str) -> str:
    """Normalize conservatively for HTTP-to-HTTPS reconciliation."""
    return _stored_url(url)


def _reconcile_http_identity(
    connection: sqlite3.Connection,
    job: CareerJob,
    new_job_key: str,
) -> None:
    """Merge the exact HTTP predecessor of a normalized same-host HTTPS job."""
    new_url = _reconciliation_url(job.apply_url)
    parsed_new = urlsplit(new_url)
    if parsed_new.scheme != "https" or not parsed_new.hostname:
        return
    candidates = connection.execute(
        """
        SELECT job_key, apply_url, first_seen_at
        FROM jobs
        WHERE source_key = ? AND provider = ? AND provider_job_id = ?
          AND job_key != ?
        """,
        (job.source_key, job.provider, job.provider_job_id, new_job_key),
    ).fetchall()
    for old in candidates:
        old_url = _reconciliation_url(old["apply_url"])
        parsed_old = urlsplit(old_url)
        if (
            parsed_old.scheme != "http"
            or parsed_old.hostname != parsed_new.hostname
            or parsed_old._replace(scheme="https").geturl() != new_url
        ):
            continue
        old_job_key = old["job_key"]
        connection.execute(
            """
            UPDATE jobs
            SET first_seen_at = CASE
                WHEN first_seen_at > ? THEN ? ELSE first_seen_at END
            WHERE job_key = ?
            """,
            (old["first_seen_at"], old["first_seen_at"], new_job_key),
        )
        connection.execute(
            """
            INSERT INTO job_streams (
                job_key, stream, location_bucket, observed_at, delivered_at
            )
            SELECT ?, stream, location_bucket, observed_at, delivered_at
            FROM job_streams WHERE job_key = ?
            ON CONFLICT(job_key, stream) DO UPDATE SET
                delivered_at = COALESCE(
                    job_streams.delivered_at, excluded.delivered_at
                )
            """,
            (new_job_key, old_job_key),
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO delivery_jobs (delivery_run_id, job_key)
            SELECT delivery_run_id, ? FROM delivery_jobs WHERE job_key = ?
            """,
            (new_job_key, old_job_key),
        )
        connection.execute("DELETE FROM delivery_jobs WHERE job_key = ?", (old_job_key,))
        connection.execute("DELETE FROM job_streams WHERE job_key = ?", (old_job_key,))
        connection.execute("DELETE FROM jobs WHERE job_key = ?", (old_job_key,))


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _matched_job(row: sqlite3.Row, stream: Stream) -> MatchedJob:
    posted_at = datetime.fromisoformat(row["posted_at"]) if row["posted_at"] else None
    job = CareerJob(
        source_key=row["source_key"],
        provider=row["provider"],
        provider_job_id=row["provider_job_id"],
        company=row["company"],
        sponsor_names=tuple(json.loads(row["sponsor_names"])),
        title=row["title"],
        location=row["location"],
        description=row["description"],
        apply_url=row["apply_url"],
        posted_at=posted_at,
        is_remote=bool(row["is_remote"]),
    )
    return MatchedJob(job=job, streams=frozenset({stream}), location_bucket=row["location_bucket"])
