from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from storage.config import get_settings
from storage.models import Base


@event.listens_for(Engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, connection_record):
    """Enable WAL + busy timeout so concurrent writers (API, lifecycle loop,
    APScheduler) don't trip over 'database is locked'. No-op for non-SQLite."""
    if "sqlite3" not in type(dbapi_connection).__module__:
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")       # readers don't block the writer
    cursor.execute("PRAGMA synchronous=NORMAL")     # safe with WAL, much faster
    cursor.execute("PRAGMA busy_timeout=10000")     # wait up to 10s for a lock
    cursor.execute("PRAGMA foreign_keys=ON")        # enforce FK constraints
    cursor.close()


def make_engine(database_url: str | None = None):
    url = database_url or get_settings().database_url
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, pool_pre_ping=True, connect_args=connect_args)


engine = make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_database() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_jobs_active_feed "
                "ON jobs (status, date_posted, last_seen_at)"
            )
        )


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
