# Legacy Hermes Email Jobs

This directory is a source-controlled, sanitized snapshot of the active legacy Hermes email-job scripts from the VM as of 2026-08-13.

Private configuration and runtime data are deliberately excluded:

- `~/.hermes/email_config.json`
- Telegram bot token files and chat identifiers
- cookies, logs, job-result state, and generated reports

The three batch scripts read `HERMES_TELEGRAM_CHAT_ID` in this repository snapshot. The production VM keeps its existing private configuration and was not altered by this archival copy.

| Hermes job | Schedule (America/Chicago) | Entry script |
| --- | --- | --- |
| `dotnet_hourly_batch` | `0 7,8,9,10,11,12,13,14,15,16,17,18,19 * * 1-5` | `run_hourly_batch_jobs.sh` |
| `dotnet_overnight_collection` | `0 7 * * 1-5` | `run_overnight_collection.sh` |
| `dotnet_weekend_collection` | `0 10 * * 6,0` | `run_weekend_collection.sh` |
| `linkedin_24h_email` | `0 * * * *` | `run_linkedin_24h_email.sh` |
| `linkedin_flash` | `*/15 7-19 * * 1-5` | `linkedin_flash.py` |
| `dice_flash` | `0,30 7-19 * * 1-5` | `dice_flash.py` |
| `linkedin_flash_ai_engineer` | `0,30 7-19 * * 1-5` | `linkedin_flash_ai_engineer.py` |

`top250_career_alerts_3hour` is maintained separately in the parent `deploy/hermes/` directory.
