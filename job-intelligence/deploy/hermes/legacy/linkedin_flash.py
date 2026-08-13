#!/home/ubuntu/jobspy-env/bin/python
import json
import smtplib
import ssl
import time
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup

SOURCE = "LinkedIn"
SLUG = "linkedin"
WINDOW_SECONDS = 900
WINDOW_LABEL = "Last 15 minutes"
EMAIL = Path.home() / ".hermes" / "email_config.json"
SEEN = Path.home() / ".hermes" / "job-results" / f"{SLUG}_flash_seen.json"
TITLES = [".NET Developer", "Senior .NET Developer", "C# Developer", ".NET Engineer"]
LOCATIONS = ["Remote", "Dallas, TX", "Texas"]
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
}


def load_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def save_seen(seen):
    SEEN.parent.mkdir(parents=True, exist_ok=True)
    SEEN.write_text(json.dumps(seen, indent=2))


def search(title, location):
    url = (
        "https://www.linkedin.com/jobs/search?"
        f"keywords={quote_plus(title)}&location={quote_plus(location)}&f_TPR=r{WINDOW_SECONDS}"
    )
    response = requests.get(url, headers=HEADERS, timeout=15)
    if response.status_code != 200:
        print(f"{SOURCE} {title}/{location}: HTTP {response.status_code}")
        return []

    soup = BeautifulSoup(response.text, "lxml")
    cards = soup.select("li.jobs-search-results__list-item") or soup.select("div.base-card")
    jobs = []
    for card in cards[:8]:
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
    time.sleep(0.2)
    return jobs


def send_email(jobs):
    cfg = load_json(EMAIL, None)
    if not cfg:
        print("No email config")
        return
    now = datetime.now()
    link_15 = (
        "https://www.linkedin.com/jobs/search?"
        f"keywords={quote_plus('.NET Developer')}&location={quote_plus('United States')}&f_TPR=r900"
    )
    link_30 = (
        "https://www.linkedin.com/jobs/search?"
        f"keywords={quote_plus('.NET Developer')}&location={quote_plus('United States')}&f_TPR=r1800"
    )
    html = f"""<html><body style="margin:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#172033">
    <div style="max-width:760px;margin:0 auto;padding:24px">
      <div style="background:#0a66c2;color:white;padding:22px 24px;border-radius:8px">
        <h1 style="margin:0 0 8px;font-size:24px">LinkedIn .NET Flash</h1>
        <div style="font-size:14px;opacity:.95">{len(jobs)} new jobs · {WINDOW_LABEL} · {now.strftime('%b %d, %Y %I:%M %p CDT')}</div>
      </div>
      <div style="background:white;border:1px solid #d8dee8;border-radius:8px;margin-top:16px;padding:16px">
        <div style="font-size:14px;color:#4b5870;margin-bottom:12px">Quick searches</div>
        <a href="{link_15}" style="display:inline-block;background:#0a66c2;color:white;text-decoration:none;padding:9px 12px;border-radius:6px;margin-right:8px">.NET Developer · 15 min</a>
        <a href="{link_30}" style="display:inline-block;background:#eef4fb;color:#0a66c2;text-decoration:none;padding:9px 12px;border-radius:6px">.NET Developer · 30 min</a>
      </div>
      <div style="margin-top:16px">
    """
    for job in jobs[:10]:
        html += f"""<div style="background:white;border:1px solid #d8dee8;border-radius:8px;margin-bottom:12px;padding:16px">
          <div style="font-size:17px;font-weight:700;margin-bottom:6px">{job['title']}</div>
          <div style="font-size:14px;color:#4b5870;margin-bottom:12px">{job['company']} · {job['location']}</div>
          <a href="{job['job_url']}" style="display:inline-block;background:#172033;color:white;text-decoration:none;padding:8px 12px;border-radius:6px">Open job</a>
        </div>"""
    html += f"""</div>
      <div style="font-size:12px;color:#667085;margin-top:16px">Runs every 15 minutes on weekdays, 7 AM-7 PM CDT. Duplicate jobs are skipped.</div>
    </div></body></html>"""
    msg = MIMEMultipart()
    msg["Subject"] = f"LinkedIn FLASH: {len(jobs)} New .NET Jobs ({WINDOW_LABEL})"
    msg["From"] = cfg["sender_email"]
    msg["To"] = cfg["recipient_email"]
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as server:
        server.login(cfg["sender_email"], cfg["sender_password"])
        server.sendmail(cfg["sender_email"], cfg["recipient_email"], msg.as_string())
    print(f"Email sent: {len(jobs)} jobs")


def main():
    seen = load_json(SEEN, {})
    new_jobs = []
    for title in TITLES:
        for location in LOCATIONS:
            for job in search(title, location):
                job_id = f"{SOURCE}_{job['title']}_{job['company']}_{job['location']}"
                if job_id not in seen:
                    seen[job_id] = datetime.now().isoformat()
                    new_jobs.append(job)
    save_seen(seen)
    print(f"Found {len(new_jobs)} new {SOURCE} jobs")
    if new_jobs:
        send_email(new_jobs)
    else:
        print("No new jobs - silent")


if __name__ == "__main__":
    main()
