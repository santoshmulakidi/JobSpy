# Job Intelligence Platform

Standalone local job intelligence platform powered by [JobSpy](https://github.com/speedyapply/JobSpy).

The app collects jobs from multiple sources, stores them locally, tracks changes,
supports H1B/visa-friendly job discovery, and provides FastAPI APIs plus a
modern glass-themed dashboard.

## Features

- Local FastAPI application
- Plain HTML/CSS/JavaScript UI, no frontend build step
- Glass-themed main dashboard with Amethyst, Light, and Dark modes
- Separate admin dashboard at `/admin`
- Job collection with JobSpy sources:
  - LinkedIn
  - Indeed
  - Google Jobs
  - ZipRecruiter
  - Glassdoor
- Additional sources:
  - Career Pages
  - Jobright H1B
  - Simplify New Grad
  - GitHub Internships
  - Dice
  - Wellfound
  - YC Jobs
  - College Recruiter
  - Remotely.jobs
  - We Work Remotely
  - CareerBuilder
- H1B/visa status classification
- Visa score and apply-priority ranking
- Remote, Hybrid, and On-site job modes with latest-first sorting
- Company-targeted searches from `data/company_targets.json`
- In-app hourly refresh controls and a command-line hourly scheduler
- Source-specific company query templates
- Direct career page collection for Greenhouse and Lever, with HTML fallback for other ATS pages
- Local SQLite database by default
- PostgreSQL-ready SQLAlchemy/Alembic structure
- pytest test suite

## Project Structure

```text
job-intelligence/
├── analytics/
├── api/
├── collectors/
├── dashboard/
├── data/
│   └── company_targets.json
├── docs/
├── notifications/
├── scheduler/
├── search/
├── storage/
├── tests/
├── web/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── admin.html
│   ├── admin.css
│   └── admin.js
├── docker-compose.yml
├── pyproject.toml
└── README.md
```

## Local URLs

After starting the API:

- Main dashboard: http://127.0.0.1:8000/
- Admin dashboard: http://127.0.0.1:8000/admin
- API docs: http://127.0.0.1:8000/docs
- Health check: http://127.0.0.1:8000/health

## macOS Installation

These steps assume Homebrew and Python 3.12 are available.

```bash
cd /Users/santoshmulakidi/job-intelligence

/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

If your Python 3.12 path is different:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

Run the app:

```bash
uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
```

Run tests:

```bash
python -m pytest tests
```

## Windows Installation

Use PowerShell.

Install Python 3.12 from:

https://www.python.org/downloads/windows/

Then:

```powershell
cd C:\path\to\job-intelligence

py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

If PowerShell blocks virtual environment activation, run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\.venv\Scripts\Activate.ps1
```

Run the app:

```powershell
uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
```

Run tests:

```powershell
python -m pytest tests
```

## Basic Usage

1. Open http://127.0.0.1:8000/
2. Go to **Collect**
3. Choose a preset or select sources manually
4. Click **Start Collection**
5. Go to **Jobs**
6. Filter by keyword, company, source, visa status, job type, remote, and salary

The Jobs page is sorted latest-first by posting date and then by the latest time
the job was seen. Use the **All Latest**, **Remote**, **Hybrid**, and **On-site**
tabs to split jobs by work mode.

Useful collect controls:

- **Select All Sources**
- **Deselect All**
- **LinkedIn Only**
- **Visa-Friendly Sources**
- **Search time** dropdown: Last 30 minutes, Last 1 hour, Last 2 hours, Last 24 hours
- **Run LinkedIn Latest**
- **LinkedIn Companies**

## H1B and Visa-Friendly Workflow

The platform supports visa-aware filtering and collection.

Visa status values include:

- C2C accepted
- H1B accepted
- No C2C
- No sponsorship
- Not specified
- OPT/CPT accepted
- Sponsorship available
- TN visa
- USC/GC required
- W2 only
- Work authorization required

The **Visa-Friendly Sources** preset uses:

- LinkedIn
- Google Jobs
- Career Pages
- Jobright H1B
- Dice

It also prioritizes companies from `data/company_targets.json` that show strong
or active sponsorship signals. The target list includes product companies with
visa-friendly signals such as Roku, Pinterest, Snap, Instacart, Reddit, MongoDB,
Nutanix, Roblox, Toast, The Trade Desk, Twilio, Box, and SoFi.

## Hourly Refresh

From the dashboard, open **Collect**, choose the search term, location, sources,
freshness, and company-target options you want, then click **Start Hourly
Refresh**. The app schedules an immediate run and then refreshes every hour while
the FastAPI process is running. Click **Stop** to disable it.

You can also run the command-line scheduler.

macOS/Linux:

```bash
cd /Users/santoshmulakidi/JobSpy/job-intelligence
source ../.venv/bin/activate
python -m scheduler.runner
```

Windows PowerShell:

```powershell
cd C:\path\to\JobSpy\job-intelligence
..\.venv\Scripts\Activate.ps1
python -m scheduler.runner
```

The scheduler defaults to every 1 hour. You can override it:

```bash
export JOB_INTELLIGENCE_SCHEDULER_HOURS=1
export JOB_INTELLIGENCE_DEFAULT_SITES="linkedin,indeed,google,career_page,jobright_h1b,dice"
```

```powershell
$env:JOB_INTELLIGENCE_SCHEDULER_HOURS="1"
$env:JOB_INTELLIGENCE_DEFAULT_SITES="linkedin,indeed,google,career_page,jobright_h1b,dice"
```

## API Endpoints

- `GET /health`
- `GET /`
- `GET /admin`
- `GET /jobs`
- `GET /jobs/{id}`
- `GET /companies`
- `GET /company-targets`
- `GET /analytics`
- `POST /collect`
- `POST /refresh`
- `POST /search`
- `GET /scheduler/status`
- `POST /scheduler/start`
- `POST /scheduler/stop`

Example collection request:

```bash
curl -X POST http://127.0.0.1:8000/collect \
  -H "Content-Type: application/json" \
  -d '{
    "search_term": "developer",
    "location": "United States",
    "sites": ["jobright_h1b"],
    "results_wanted": 25,
    "hours_old": 168
  }'
```

## Database

The default local database is SQLite:

```text
job_intelligence.db
```

This file is ignored by git and should not be committed.

For PostgreSQL, set:

```bash
export JOB_INTELLIGENCE_DATABASE_URL="postgresql+psycopg://jobintel:jobintel@localhost:5432/jobintel"
alembic upgrade head
```

Windows PowerShell:

```powershell
$env:JOB_INTELLIGENCE_DATABASE_URL="postgresql+psycopg://jobintel:jobintel@localhost:5432/jobintel"
alembic upgrade head
```

## Docker

```bash
docker compose up --build
```

- API: http://localhost:8000
- Optional Streamlit dashboard: http://localhost:8501

## Git Notes

Safe files to commit:

- `api/`
- `collectors/`
- `storage/`
- `search/`
- `analytics/`
- `tests/`
- `web/`
- `data/company_targets.json`
- `README.md`
- `pyproject.toml`
- `docker-compose.yml`
- `docker/`
- `docs/`

Do not commit:

- `.venv/`
- `*.db`
- `*.log`
- `*.pid`
- `.env`
- `__pycache__/`
- `.pytest_cache/`

Current `.gitignore` already excludes logs, pid files, local SQLite database,
and `.env`.

Recommended git commands:

```bash
cd /Users/santoshmulakidi/job-intelligence

git status
git add .
git commit -m "Build job intelligence platform"
git push origin main
```

If no remote exists:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

## Troubleshooting

If port 8000 is already in use:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
kill <PID>
```

Windows PowerShell:

```powershell
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

If a source returns blocked/experimental errors, that usually means the job
board is blocking automated requests or requires JavaScript/browser interaction.
The app records the error and continues with other sources.
