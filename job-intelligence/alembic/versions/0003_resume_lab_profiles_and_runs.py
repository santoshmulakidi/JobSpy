"""add Resume Lab profiles and runs

Revision ID: 0003_resume_lab_profiles_and_runs
Revises: 126436604a64
"""

from alembic import op
import sqlalchemy as sa

revision = "0003_resume_lab_profiles_and_runs"
down_revision = "126436604a64"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resume_lab_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("resume_text", sa.Text()),
        sa.Column("resume_filename", sa.String(255)),
        sa.Column("resume_sha256", sa.String(64)),
        sa.Column("fact_inventory", sa.JSON()),
        sa.Column("source_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("name", name="uq_resume_lab_profiles_name"),
    )
    op.create_index("ix_resume_lab_profiles_resume_sha256", "resume_lab_profiles", ["resume_sha256"])
    op.create_table(
        "resume_lab_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("cache_key", sa.String(64), nullable=False),
        sa.Column("profile_id", sa.Integer(), sa.ForeignKey("resume_lab_profiles.id"), nullable=False),
        sa.Column("mode", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("source_hash", sa.String(64), nullable=False),
        sa.Column("input_hash", sa.String(64), nullable=False),
        sa.Column("job_description_hash", sa.String(64), nullable=False),
        sa.Column("target_title", sa.String(500), nullable=False),
        sa.Column("company_name", sa.String(255)),
        sa.Column("content_text", sa.Text()),
        sa.Column("ats_score", sa.Integer()),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("usage", sa.JSON(), nullable=False),
        sa.Column("original_titles", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("idempotency_key", name="uq_resume_lab_runs_idempotency_key"),
    )
    op.create_index("ix_resume_lab_runs_profile_id", "resume_lab_runs", ["profile_id"])
    op.create_index("ix_resume_lab_runs_cache", "resume_lab_runs", ["cache_key", "status"])


def downgrade() -> None:
    op.drop_index("ix_resume_lab_runs_cache", table_name="resume_lab_runs")
    op.drop_index("ix_resume_lab_runs_profile_id", table_name="resume_lab_runs")
    op.drop_table("resume_lab_runs")
    op.drop_index("ix_resume_lab_profiles_resume_sha256", table_name="resume_lab_profiles")
    op.drop_table("resume_lab_profiles")
