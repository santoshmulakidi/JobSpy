# Top-250 Career Alerts: Requirements and Prompt Record

## Purpose

Collect official career-site jobs from the FY2026 H-1B sponsor Top 250 and deliver separate job-alert emails for .NET Developer and AI Engineer roles.

## Delivery

- Recipient: configured privately on the VM; do not store credentials in Git.
- Send two separate emails at each run: `.NET Developer` and `AI Engineer`.
- Weekdays, America/Chicago: 7 AM, 10 AM, 1 PM, 4 PM, and 7 PM.
- Daytime subjects use `[3-Hour Jobs]`; 7 AM covers overnight jobs, and Monday 7 AM covers Friday 7 PM through Monday 7 AM.
- Include a successful zero-result email, split messages at 100 jobs, and avoid duplicate sends per stream.

## Matching and location

- .NET roles require an explicit .NET technology marker and development context.
- AI roles cover AI/ML, applied AI, generative AI, LLM, AI platform, and related software-engineering titles, with technical context such as Python, backend, API, cloud, RAG, or LLM.
- Include U.S.-eligible jobs only and label them as `Remote`, `DFW Metro`, or `Other USA`.

## Sources and safety

- Use direct official ATS/career sources first; use Crawl4AI only for approved custom fallbacks.
- Do not use Firecrawl.
- Preserve existing Hermes jobs; add only the dedicated Top-250 schedule.
- Keep credentials, cookies, email passwords, and complete provider responses out of Git and logs.
- Bound provider requests, retries, pagination, job counts, and per-source runtime; retain source-health results.

## Operational record

- Hermes job name: `top250_career_alerts_3hour`.
- Schedule: `0 7,10,13,16,19 * * 1-5`.
- Operational procedures: `docs/top250-career-alerts-operations.md`.
