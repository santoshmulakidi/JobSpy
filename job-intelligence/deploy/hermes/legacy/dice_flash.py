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

SOURCE = "Dice"
SLUG = "dice"
EMAIL = Path.home() / ".hermes" / "email_config.json"
SEEN = Path.home() / ".hermes" / "job-results" / f"{SLUG}_flash_seen.json"
TITLES = [".NET Developer", "Senior .NET Developer", "C# Developer", ".NET Engineer"]
LOCATIONS = ["Remote", "Dallas, TX", "Texas"]
HEADERS = {"User-Agent": "Mozilla/5.0"}


def load_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def save_seen(seen):
    SEEN.parent.mkdir(parents=True, exist_ok=True)
    SEEN.write_text(json.dumps(seen, indent=2))


def search(title, location):
    url = f"https://www.dice.com/jobs?q={quote_plus(title)}&l={quote_plus(location)}&postDate=1"
    response = requests.get(url, headers=HEADERS, timeout=15)
    if response.status_code != 200:
        print(f"{SOURCE} {title}/{location}: HTTP {response.status_code}")
        return []

    soup = BeautifulSoup(response.text, "lxml")
    cards = soup.select("div.complete-card, div.card")
    jobs = []
    for card in cards[:8]:
        title_el = card.select_one("h2 a, a[data-cy='card-title-link']")
        company_el = card.select_one('[data-cy="card-company-name"]')
        location_el = card.select_one('[data-cy="card-details-location"]')
        link = title_el.get("href", "") if title_el else ""
        if link and not link.startswith("http"):
            link = f"https://www.dice.com{link}"
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
    html = f"<html><body><h1>{SOURCE} FLASH: {len(jobs)} Jobs</h1>"
    for job in jobs[:10]:
        html += (
            f"<div><b>{job['title']}</b><br>{job['company']}<br>{job['location']}<br>"
            f"<a href='{job['job_url']}'>Apply</a></div><br>"
        )
    html += "</body></html>"
    msg = MIMEMultipart()
    msg["Subject"] = f"FLASH: {len(jobs)} New .NET Jobs - {SOURCE}"
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
