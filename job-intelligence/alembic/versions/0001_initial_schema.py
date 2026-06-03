from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("website_url", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_companies_name", "companies", ["name"])

    op.create_table(
        "search_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("search_term", sa.String(length=255), nullable=False),
        sa.Column("location", sa.String(length=255), nullable=True),
        sa.Column("sites", sa.JSON(), nullable=False),
        sa.Column("results_wanted", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("jobs_seen", sa.Integer(), nullable=False),
        sa.Column("error_count", sa.Integer(), nullable=False),
        sa.Column("errors", sa.JSON(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
    )
    op.create_index("ix_search_runs_search_term", "search_runs", ["search_term"])
    op.create_index("ix_search_runs_location", "search_runs", ["location"])

    op.create_table(
        "jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=80), nullable=False),
        sa.Column("source_job_id", sa.String(length=255), nullable=True),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=True),
        sa.Column("company_name", sa.String(length=255), nullable=True),
        sa.Column("job_url", sa.String(length=2000), nullable=True),
        sa.Column("job_url_direct", sa.String(length=2000), nullable=True),
        sa.Column("location", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("job_type", sa.String(length=255), nullable=True),
        sa.Column("is_remote", sa.Boolean(), nullable=True),
        sa.Column("date_posted", sa.Date(), nullable=True),
        sa.Column("interval", sa.String(length=40), nullable=True),
        sa.Column("min_amount", sa.Float(), nullable=True),
        sa.Column("max_amount", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(length=12), nullable=True),
        sa.Column("status", sa.Enum("ACTIVE", "REMOVED", name="jobstatus"), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("raw", sa.JSON(), nullable=False),
        sa.Column("search_run_id", sa.Integer(), sa.ForeignKey("search_runs.id"), nullable=True),
        sa.UniqueConstraint("fingerprint", name="uq_jobs_fingerprint"),
    )
    op.create_index("ix_jobs_fingerprint", "jobs", ["fingerprint"])
    op.create_index("ix_jobs_source", "jobs", ["source"])
    op.create_index("ix_jobs_source_job_id", "jobs", ["source_job_id"])
    op.create_index("ix_jobs_title", "jobs", ["title"])
    op.create_index("ix_jobs_company_name", "jobs", ["company_name"])
    op.create_index("ix_jobs_location", "jobs", ["location"])
    op.create_index("ix_jobs_is_remote", "jobs", ["is_remote"])
    op.create_index("ix_jobs_status", "jobs", ["status"])
    op.create_index("ix_jobs_search", "jobs", ["title", "location", "is_remote"])
    op.create_index("ix_jobs_salary", "jobs", ["min_amount", "max_amount"])

    op.create_table(
        "job_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("jobs.id"), nullable=False),
        sa.Column("search_run_id", sa.Integer(), sa.ForeignKey("search_runs.id"), nullable=True),
        sa.Column("change_type", sa.Enum("NEW", "UPDATED", "REMOVED", name="changetype"), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("before", sa.JSON(), nullable=True),
        sa.Column("after", sa.JSON(), nullable=True),
    )
    op.create_index("ix_job_changes_job_id", "job_changes", ["job_id"])
    op.create_index("ix_job_changes_search_run_id", "job_changes", ["search_run_id"])
    op.create_index("ix_job_changes_change_type", "job_changes", ["change_type"])


def downgrade() -> None:
    op.drop_table("job_changes")
    op.drop_table("jobs")
    op.drop_table("search_runs")
    op.drop_table("companies")
    op.execute("DROP TYPE IF EXISTS jobstatus")
    op.execute("DROP TYPE IF EXISTS changetype")
