# Job Intelligence Platform Architecture

## System Shape

```text
job-intelligence/
├── collectors/       # JobSpy adapter, retry logic, deduplication, company page extension
├── storage/          # SQLAlchemy models, sessions, repository, persistence lifecycle
├── search/           # Keyword/company/location/remote/salary search facade
├── analytics/        # Trends, skills, salary summaries, AI extension point
├── api/              # FastAPI app and request/response schemas
├── web/              # Local-only HTML/CSS/JS dashboard served by FastAPI
├── dashboard/        # Streamlit explorer and analytics UI
├── scheduler/        # Four-hour recurring collection runner
├── notifications/    # Slack, Discord, Telegram dispatch
├── tests/            # Unit and integration tests
├── docker/           # Container image
└── docs/             # Architecture and roadmap
```

## Collector Framework

`JobSpyCollector` accepts a `CollectionRequest`, calls `jobspy.scrape_jobs`, retries
transient failures, logs attempts, converts the DataFrame into dictionaries, and
deduplicates records by source ID or URL. Supported JobSpy sources are LinkedIn,
Indeed, Google Jobs, ZipRecruiter, and Glassdoor. CareerBuilder, Remotely.jobs,
and We Work Remotely are handled by separate defensive HTML collectors because
they are not native JobSpy sources. CareerBuilder and We Work Remotely may return
JavaScript challenges to automated requests; Remotely.jobs currently returns
parseable public result cards. Company career pages are isolated behind
`CompanyCareerPageCollector` so ATS-specific logic can be added later.

## Database Schema

- `companies`: normalized company names and future enrichment metadata.
- `search_runs`: each collection execution, query, sites, result counts, and errors.
- `jobs`: active job inventory with fingerprint, source, title, company, location,
  remote flag, salary fields, description, raw source payload, and lifecycle dates.
- `job_changes`: immutable history for new, updated, and removed jobs.

## API Design

- `GET /jobs`: filter by keyword, company, location, remote, and salary.
- `GET /jobs/{id}`: fetch one job.
- `GET /companies`: list known companies.
- `GET /analytics`: return trends and summaries.
- `POST /collect`: run a collection and persist results.
- `POST /search`: body-based search with the same filters as `GET /jobs`.

## Analytics Engine

Phase 1 analytics include trending companies, location trends, salary summaries,
and deterministic skill counts. Phase 5 expands this with provider-neutral AI
analysis for summaries, skill extraction, categorization, seniority detection, and
technology extraction.

## Dashboard

The primary local UI is served from FastAPI at `/` with plain HTML, CSS, and
JavaScript. It provides a collection form, job explorer, analytics charts, company
list, keyword search, remote filtering, and a job detail drawer. The Streamlit
dashboard remains as an optional alternate dashboard and uses the same repository
and service layer as the API.

## Automation

`scheduler.runner` runs collection every four hours by default and sends a summary
through configured notification channels. The interval is configurable via
`JOB_INTELLIGENCE_SCHEDULER_HOURS`.

## Production Roadmap

1. Harden collector rate limiting, per-site retries, proxy support, and pagination telemetry.
2. Add ATS collectors for Greenhouse, Lever, Workday, Ashby, and company-specific feeds.
3. Move text search to PostgreSQL full-text indexes, then optionally OpenSearch.
4. Add AI enrichment workers with OpenAI, Claude, and Gemini provider adapters.
5. Add saved searches, watchlists, API keys, users, RBAC, and audit logs.
6. Add email notifications and richer Slack/Discord/Telegram payloads.
7. Add async background jobs with Celery, Dramatiq, or Arq for large collection runs.
8. Add CI database integration tests and production deployment manifests.
