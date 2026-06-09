from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_add_archived_job_status"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLite stores enums as VARCHAR so no ALTER TYPE needed; for PostgreSQL we
    # add the new value to the existing enum type.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'archived' AFTER 'active'")
    # For SQLite (and any VARCHAR-backed dialect) the string value is accepted
    # automatically once the Python enum is updated — no DDL required.


def downgrade() -> None:
    # PostgreSQL does not support removing enum values without recreating the type.
    # For SQLite nothing was changed. Safe to leave as a no-op.
    pass
