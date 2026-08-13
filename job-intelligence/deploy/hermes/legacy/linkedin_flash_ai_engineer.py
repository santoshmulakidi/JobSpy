#!/home/ubuntu/jobspy-env/bin/python
import argparse
import html
import json
import smtplib
import ssl
import time
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from urllib.parse import quote_plus, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup


SOURCE = "LinkedIn"
WINDOW_SECONDS = 1800
WINDOW_LABEL = "Last 30 minutes"
QUERY = (
    '("AI Engineer" OR "AI/ML Engineer" OR "Applied AI Engineer" OR '
    '"Generative AI Engineer" OR "LLM Engineer" OR "Software Engineer, AI" OR '
    '"Software Engineer, Applied AI" OR "AI Platform Engineer") AND '
    '(Python OR backend OR API OR cloud OR RAG OR LLM)'
)
LOCATIONS = ["Remote", "Dallas-Fort Worth Metroplex", "United States"]
EMAIL = Path.home() / ".hermes" / "email_config.json"
SEEN = Path.home() / ".hermes" / "job-results" / "linkedin_ai_engineer_flash_seen.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
}


class SearchError(RuntimeError):
    pass


def load_json(path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json_atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")
    temporary.replace(path)


def canonical_url(value):
    if not value:
        return ""
    parts = urlsplit(value)
    path = parts.path.rstrip("/")
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, "", ""))


def job_identity(job):
    url = canonical_url(job.get("job_url", ""))
    if url:
        return f"url|{url}"
    fields = [job.get(key, "").strip().lower() for key in ("title", "company", "location")]
    return "fallback|" + "|".join(fields)


def search(query, location):
    url = (
        "https://www.linkedin.com/jobs/search?"
        f"keywords={quote_plus(query)}&location={quote_plus(location)}&f_TPR=r{WINDOW_SECONDS}"
    )
    response = requests.get(url, headers=HEADERS, timeout=15)
    if response.status_code != 200:
        raise SearchError(f"HTTP {response.status_code}")

    soup = BeautifulSoup(response.text, "lxml")
    cards = soup.select("li.jobs-search-results__list-item") or soup.select("div.base-card")
    jobs = []
    for card in cards[:15]:
        title_el = card.select_one("h3 a") or card.select_one("h3.base-search-card__title")
        company_el = card.select_one("h4 a") or card.select_one("h4.base-search-card__subtitle")
        location_el = card.select_one("span.job-search-card__location")
        link_el = title_el if title_el and title_el.name == "a" else card.select_one("a.base-card__full-link")
        link = link_el.get("href", "") if link_el else ""
        if link.startswith("/"):
            link = f"https://www.linkedin.com{link}"
        if title_el and link:
            jobs.append(
                {
                    "title": title_el.get_text(strip=True),
                    "company": company_el.get_text(strip=True) if company_el else "Unknown",
                    "location": location_el.get_text(strip=True) if location_el else location,
                    "job_url": link,
                }
            )
    time.sleep(0.35)
    return jobs


def collect(search_fn=search):
    unique = {}
    stats = {"attempted": 0, "failed": 0}
    for location in LOCATIONS:
        stats["attempted"] += 1
        try:
            jobs = search_fn(QUERY, location)
        except Exception as exc:
            stats["failed"] += 1
            print(f"{SOURCE} AI Engineer/{location}: {exc}")
            continue
        for job in jobs:
            unique.setdefault(job_identity(job), job)
    return list(unique.values()), stats


def send_email(jobs):
    cfg = load_json(EMAIL, None)
    if not cfg:
        raise RuntimeError(f"Email configuration not found: {EMAIL}")

    now = datetime.now().astimezone()
    quick_links = []
    for location in LOCATIONS:
        href = (
            "https://www.linkedin.com/jobs/search?"
            f"keywords={quote_plus(QUERY)}&location={quote_plus(location)}&f_TPR=r{WINDOW_SECONDS}"
        )
        quick_links.append(
            f'<a href="{html.escape(href, quote=True)}" '
            'style="display:inline-block;background:#eef4fb;color:#0a66c2;text-decoration:none;'
            f'padding:9px 12px;border-radius:6px;margin:0 6px 6px 0">{html.escape(location)}</a>'
        )

    body = f"""<html><body style="margin:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#172033">
    <div style="max-width:760px;margin:0 auto;padding:24px">
      <div style="background:#0a66c2;color:white;padding:22px 24px;border-radius:8px">
        <h1 style="margin:0 0 8px;font-size:24px">LinkedIn AI Engineer Flash</h1>
        <div style="font-size:14px;opacity:.95">{len(jobs)} new jobs · {WINDOW_LABEL} · {now.strftime('%b %d, %Y %I:%M %p %Z')}</div>
      </div>
      <div style="background:white;border:1px solid #d8dee8;border-radius:8px;margin-top:16px;padding:16px">
        <div style="font-size:14px;color:#4b5870;margin-bottom:12px">Quick searches</div>
        {''.join(quick_links)}
      </div>
      <div style="margin-top:16px">"""
    for job in jobs[:15]:
        title = html.escape(job["title"])
        company = html.escape(job["company"])
        location = html.escape(job["location"])
        job_url = html.escape(job["job_url"], quote=True)
        body += f"""<div style="background:white;border:1px solid #d8dee8;border-radius:8px;margin-bottom:12px;padding:16px">
          <div style="font-size:17px;font-weight:700;margin-bottom:6px">{title}</div>
          <div style="font-size:14px;color:#4b5870;margin-bottom:12px">{company} · {location}</div>
          <a href="{job_url}" style="display:inline-block;background:#172033;color:white;text-decoration:none;padding:8px 12px;border-radius:6px">Open job</a>
        </div>"""
    body += """</div>
      <div style="font-size:12px;color:#667085;margin-top:16px">Runs every 30 minutes on weekdays, 7:00 AM-7:30 PM Central. Duplicate jobs are skipped.</div>
    </div></body></html>"""

    msg = MIMEMultipart()
    msg["Subject"] = f"LinkedIn AI FLASH: {len(jobs)} New AI Engineer Jobs ({WINDOW_LABEL})"
    msg["From"] = cfg["sender_email"]
    msg["To"] = cfg["recipient_email"]
    msg.attach(MIMEText(body, "html"))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as server:
        server.login(cfg["sender_email"], cfg["sender_password"])
        server.sendmail(cfg["sender_email"], cfg["recipient_email"], msg.as_string())
    print(f"Email sent: {len(jobs)} jobs")


def run(search_fn=search, send_fn=send_email, seen_path=SEEN, dry_run=False):
    seen = load_json(seen_path, {})
    jobs, stats = collect(search_fn)
    unseen = [job for job in jobs if job_identity(job) not in seen]
    print(
        f"Searches attempted={stats['attempted']} failed={stats['failed']} "
        f"unique={len(jobs)} unseen={len(unseen)}"
    )

    if dry_run:
        print("Dry run: email and seen-state writes disabled")
        return 0
    if not unseen:
        print("No new jobs - silent")
        return 0

    send_fn(unseen)
    timestamp = datetime.now().astimezone().isoformat()
    for job in unseen:
        seen[job_identity(job)] = timestamp
    save_json_atomic(seen_path, seen)
    return 0


def main():
    parser = argparse.ArgumentParser(description="LinkedIn AI Engineer flash alert")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Search and report counts without email or seen-state changes",
    )
    args = parser.parse_args()
    return run(dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
