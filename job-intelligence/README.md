# Job Intelligence Platform

Standalone job intelligence application powered by JobSpy. It aggregates jobs,
stores them, tracks changes, exposes APIs, and provides a Streamlit dashboard.

## Quick Start

```bash
cd job-intelligence
python -m pip install -e ".[dev]"
uvicorn api.main:app --reload
streamlit run dashboard/app.py
```

The local FastAPI UI is available at http://127.0.0.1:8000. The Streamlit
dashboard remains available as an optional alternate dashboard.

The default database is local SQLite for development. Use PostgreSQL in
production:

```bash
export JOB_INTELLIGENCE_DATABASE_URL=postgresql+psycopg://jobintel:jobintel@localhost:5432/jobintel
alembic upgrade head
```

## API

- `GET /jobs`
- `GET /jobs/{id}`
- `GET /companies`
- `GET /analytics`
- `POST /collect`
- `POST /search`

## Local UI

The basic local UI uses plain HTML, CSS, and JavaScript. It is served by FastAPI
from `web/` and calls only local API endpoints:

- `/` opens the dashboard.
- `/static/styles.css` provides styling.
- `/static/app.js` handles API calls, filters, collection runs, and details.

## Docker

```bash
docker compose up --build
```

- API: http://localhost:8000
- Dashboard: http://localhost:8501
