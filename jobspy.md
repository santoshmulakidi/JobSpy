# Job Intelligence Platform

Full-stack job tracking and AI resume platform.  
Stack: FastAPI (port 8000) · Next.js (port 3000) · SQLite (WAL) · Docker Compose · nginx reverse proxy  
VM: Oracle Free Tier — `ubuntu@163.192.111.51`  
SSH key: `~/.ssh/ssh-key-2026-05-28.key`  
Public URL: `http://163.192.111.51`

---

## Repo layout

```
/Users/santoshmulakidi/JobSpy/
  job-intelligence/
    api/            FastAPI backend
    frontend/       Next.js frontend
    scheduler/      APScheduler (collection + direct scrape jobs)
    scraper/        Direct portal scrapers (Greenhouse / Lever / Ashby)
    storage/        SQLAlchemy models + repository + migrations
    ai/             Resume rebuild / cover letter / cold email (Gemini, Groq, OpenRouter)
    alembic/        DB migrations
    docker-compose.yml
    .env            API keys (never commit)
```

---

## Deploy

> Say **"deploy"** and Claude will run all steps below automatically.

### Steps (Claude executes these)

```bash
# 1. Local — confirm latest commit is pushed
cd /Users/santoshmulakidi/JobSpy
git status
git log --oneline -3

# 2. SSH into VM and pull + rebuild
ssh -i ~/.ssh/ssh-key-2026-05-28.key ubuntu@163.192.111.51 '
  cd ~/JobSpy &&
  git fetch origin &&
  git checkout main &&
  git pull origin main &&
  echo "HEAD: $(git rev-parse --short HEAD)" &&
  cd job-intelligence &&
  docker compose down --remove-orphans &&
  docker compose up -d --build &&
  docker compose ps
'

# 3. Wait for containers, then health-check
sleep 10
ssh -i ~/.ssh/ssh-key-2026-05-28.key ubuntu@163.192.111.51 '
  curl -fsS http://localhost/api/health &&
  curl -fsS -o /dev/null -w "jobs page: %{http_code}\n" http://localhost/jobs
'

# 4. 502 recovery (if nginx hasn't warmed up yet)
# ssh ... 'docker compose restart nginx && sleep 5 && curl -fsS http://localhost/api/health'

# 5. Public verify (from local)
curl -fsS http://163.192.111.51/api/health
curl -fsS -o /dev/null -w "public jobs page: %{http_code}\n" http://163.192.111.51/jobs
```

### Rules
- Never print or expose `.env` API keys
- Ignore untracked local scratch files (`BUG_REPORT.md`, `test_*.py`, `*.csv`) unless explicitly asked to commit
- On temporary 502 after startup: wait and retry; if still failing, restart nginx container

---

## Architecture

### Schedulers (APScheduler, `America/Chicago`)

| Window | Interval | Job |
|---|---|---|
| 7 AM – 7 PM CDT | every 2.5 h | `run_collection` (JobSpy aggregators) |
| 7 PM – 7 AM CDT | every 4 h | `run_collection` |
| 7 AM – 7 PM CDT | every 2.5 h | `run_direct_scrape` (Greenhouse/Lever/Ashby) |
| 7 PM – 7 AM CDT | every 4 h | `run_direct_scrape` |

Manual triggers: `POST /api/scheduler/trigger` · `POST /api/direct-jobs/trigger`

### Direct portal scraper

- **Greenhouse** — `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`
- **Lever** — `https://api.lever.co/v0/postings/{slug}?mode=json`
- **Ashby** — `POST https://jobs.ashbyhq.com/api/non-user-graphql`

Companies: `scraper/company_list.py` (~145 entries, all slugs verified)  
Filter: title must contain `.NET` / `C#` / `ASP.NET` / `Blazor` / `WPF` / `Xamarin` / `WinForms` explicitly  
`date_posted` always set to `date.today()` — bypasses the 7-day stale filter in `upsert_jobs`

### Job lifecycle

- Active → Archived after 168 h without re-scrape (`archive_stale_jobs`)
- Archived → Deleted after 7 days (unless applied)
- Stale date filter: skip jobs where `date_posted` < today − 7 days (bypassed for direct sources)

### AI documents

Queue: `POST /api/documents/generate`  
Auto-queue top-10: `POST /api/documents/auto-queue-top?n=10&min_fit=60`  
Worker: background loop in API container, polls every 30 s  
Providers: Gemini → Groq → OpenRouter → NVIDIA (fallback chain)

### Resume Ready

`JobOut` carries `best_ats_score` (max across all resume versions) and `resume_ready` (score ≥ 90).  
Frontend: green **Resume Ready · ATS XX%** badge on job rows; dedicated **Resume Ready ✓** tab.

---

## Key endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/jobs` | Active jobs (supports `?direct=true`) |
| GET | `/api/jobs/{id}` | Single job |
| GET | `/api/jobs/{id}/documents` | Resume + cover letter versions |
| POST | `/api/collect` | Trigger JobSpy collection |
| POST | `/api/scheduler/trigger` | Manual collection run |
| POST | `/api/direct-jobs/trigger` | Manual direct-portal scrape |
| POST | `/api/documents/generate` | Queue AI doc generation |
| POST | `/api/documents/auto-queue-top` | Queue top-N unprocessed jobs |
| GET | `/api/documents/generation-jobs` | Queue status |
| POST | `/api/resume/rebuild` | AI resume rebuild |
| POST | `/api/resume/cover-letter` | AI cover letter |
| POST | `/api/resume/export-docx` | Export resume as DOCX |
| GET | `/api/health` | Health check |

---

## Frontend features

| Tab | Description |
|---|---|
| Active today | All active jobs, default sort: fit score × recency |
| Qualified | Jobs matching profile skills |
| Remote / Hybrid / On-site | Work mode filters |
| Archived | Expired jobs |
| Direct portals | Greenhouse / Lever / Ashby direct-apply jobs |
| Resume Ready ✓ | Jobs with AI resume, ATS ≥ 90%, sorted by score |

**Queue Top 10** button — one click queues resume generation for top 10 high-fit jobs not yet processed, using the resume stored in your profile.

Download filenames: `Santosh_Mulakidi_JobTitle_Company.docx` / `Santosh_Mulakidi_Cover_Letter_JobTitle_Company.docx`  
Downloads folder: `/Users/santoshmulakidi/Downloads/JobIntelligence/`

---

## Common ops

```bash
# Tail API logs
ssh -i ~/.ssh/ssh-key-2026-05-28.key ubuntu@163.192.111.51 \
  'cd ~/JobSpy/job-intelligence && docker compose logs -f --tail=50 api'

# Tail scheduler logs
ssh ... 'cd ~/JobSpy/job-intelligence && docker compose logs -f --tail=50 scheduler'

# Manual direct scrape
curl -X POST http://163.192.111.51/api/direct-jobs/trigger

# Manual collection
curl -X POST http://163.192.111.51/api/scheduler/trigger

# Source counts
curl http://163.192.111.51/api/source-counts | python3 -m json.tool

# DB backup (runs automatically hourly)
ls ~/JobSpy/job-intelligence/backups/
```

---

## Adding companies to direct scraper

1. Verify slug:
   - Greenhouse: `curl https://boards-api.greenhouse.io/v1/boards/{slug}/jobs`
   - Lever: `curl https://api.lever.co/v0/postings/{slug}?mode=json`
   - Ashby: POST to `https://jobs.ashbyhq.com/api/non-user-graphql` with `organizationHostedJobsPageName: "{slug}"`
2. Append tuple to `scraper/company_list.py`: `("platform", "slug", "Display Name")`
3. Commit, push, say **"deploy"**
