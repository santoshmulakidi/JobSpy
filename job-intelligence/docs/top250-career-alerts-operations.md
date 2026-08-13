# Top 250 career alerts operations guide

## Scope and safety

This guide covers the top250_career_alerts_3hour Hermes job only. Do not put
SMTP passwords, cookies, provider response bodies, or email configuration into
terminal output, tickets, or logs.

Before a production action, inspect the active job and current alert state:

    /home/ubuntu/.hermes/hermes-agent/venv/bin/hermes cron list
    cd /home/ubuntu/JobSpy/job-intelligence && .venv-career-alerts/bin/python -m career_alerts.cli status
    tail -n 200 /home/ubuntu/.hermes/logs/top250_career_alerts.log

The status command is read-only. The log tail should be used to review source
counts, delivery state, checkpoints, and sanitized errors; do not copy any
sensitive values into incident notes.

## Dry run and validation

Validate the reviewed Top-250 registry before enabling or resuming a job:

    cd /home/ubuntu/JobSpy/job-intelligence && .venv-career-alerts/bin/python -m career_alerts.cli validate
    cd /home/ubuntu/JobSpy/job-intelligence && .venv-career-alerts/bin/python -m career_alerts.cli collect --no-email

collect --no-email records collection and matching state but sends no email.
It is the safe manual verification command for provider health, matching, and
pending-job counts.

## Manual scheduled run

Only run the scheduled Hermes job when an operator has approved a real
collection and delivery:

    CAREER_JOB_ID=$(/home/ubuntu/.hermes/hermes-agent/venv/bin/python -c 'import json; d=json.load(open("/home/ubuntu/.hermes/cron/jobs.json")); print(next(j["id"] for j in d["jobs"] if j["name"]=="top250_career_alerts_3hour"))')
    /home/ubuntu/.hermes/hermes-agent/venv/bin/hermes cron run "$CAREER_JOB_ID"

Afterward, use status and the sanitized log tail above to verify the
checkpoint, source failures, deliveries, and pending jobs. A delivery failure
leaves that stream pending for the next run; do not manually edit the SQLite
database to force it delivered.

## Weekend and missed-run recovery

The Monday 7 AM delivery window is Weekend Jobs Fri 7 PM-Mon 7 AM. Pending
jobs discovered during a missed scheduled run remain pending and are included
once when the next appropriate stream delivery succeeds. Do not run individual
weekend catch-up jobs or reset delivery rows; inspect pending counts with
status, then allow the next scheduled run or perform one approved manual run.

Offline verification covers the Friday-to-Monday window, including daylight
saving boundaries, and verifies unsent jobs persist over missed runs.

## Source degradation and recovery

Three consecutive source failures mark that source degraded. A later successful
source result resets its failure count without disabling the source. First use
the no-email dry run to distinguish a transient source problem from delivery
failure. Record only source identifiers, error codes, counts, and timestamps in
the incident; never preserve provider page bodies or credentials.

## Pause, resume, and rollback

To pause or resume only this alert job:

    CAREER_JOB_ID=$(/home/ubuntu/.hermes/hermes-agent/venv/bin/python -c 'import json; d=json.load(open("/home/ubuntu/.hermes/cron/jobs.json")); print(next(j["id"] for j in d["jobs"] if j["name"]=="top250_career_alerts_3hour"))')
    /home/ubuntu/.hermes/hermes-agent/venv/bin/hermes cron pause "$CAREER_JOB_ID"
    /home/ubuntu/.hermes/hermes-agent/venv/bin/hermes cron resume "$CAREER_JOB_ID"

For rollback, pause only top250_career_alerts_3hour. Do not delete its SQLite
state and do not alter other Hermes jobs. Keeping the state database preserves
deduplication, first-seen timestamps, pending deliveries, and source-health
recovery history.
