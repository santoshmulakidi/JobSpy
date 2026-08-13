#!/usr/bin/env python3
"""
🔗 LINKEDIN .NET JOB SCRAPER
Searches LinkedIn for .NET jobs posted in the last 24 hours
Sends email alerts with new jobs (NO Telegram)
"""

import requests, json, time, smtplib, ssl, re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pathlib import Path
from datetime import datetime, timedelta
from bs4 import BeautifulSoup
from urllib.parse import quote_plus
import random

# ============ CONFIGURATION ============
EMAIL_CONFIG = Path.home() / ".hermes" / "email_config.json"
SEEN_FILE = Path.home() / ".hermes" / "job-results" / "linkedin_seen.json"

# Search parameters
JOB_TITLES = [
    ".NET Developer",
    "Senior .NET Developer",
    "Lead .NET Developer",
    "Principal .NET Engineer",
    "C# Developer",
    ".NET Software Engineer",
    "Full Stack .NET Developer"
]

LOCATIONS = ["Remote", "Dallas, TX", "Texas", "United States"]

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
}

# ============ HELPER FUNCTIONS ============

def load_cfg():
    """Load email configuration"""
    return json.loads(EMAIL_CONFIG.read_text()) if EMAIL_CONFIG.exists() else None

def load_seen():
    """Load previously seen job IDs"""
    return json.loads(SEEN_FILE.read_text()) if SEEN_FILE.exists() else {}

def save_seen(seen_dict):
    """Save job IDs to prevent duplicates"""
    SEEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    SEEN_FILE.write_text(json.dumps(seen_dict, indent=2))

def search_linkedin(title, location):
    """Search LinkedIn jobs posted in last 24 hours"""
    print(f"  🔍 LinkedIn: '{title}' in {location}")
    jobs = []

    try:
        # LinkedIn search URL - last 24 hours (f_TPR=r86400)
        url = f"https://www.linkedin.com/jobs/search?keywords={quote_plus(title)}&location={quote_plus(location)}&f_TPR=r86400&position=1&pageNum=0"

        resp = requests.get(url, headers=HEADERS, timeout=30)

        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, 'lxml')
            job_cards = soup.select('li.jobs-search-results__list-item') or soup.select('div.base-card')

            for card in job_cards[:15]:  # Get top 15 results
                title_el = card.select_one('h3 a') or card.select_one('h3.base-search-card__title')
                company_el = card.select_one('h4 a') or card.select_one('h4.base-search-card__subtitle')
                loc_el = card.select_one('span.job-search-card__location')
                link_el = title_el if title_el and title_el.name == 'a' else card.select_one('a.base-card__full-link')

                link = link_el.get('href', '') if link_el else ''
                if link and link.startswith('/'):
                    link = f'https://www.linkedin.com{link}'

                job = {
                    'title': title_el.text.strip() if title_el else 'Unknown',
                    'company': company_el.text.strip() if company_el else 'Unknown',
                    'location': loc_el.text.strip() if loc_el else location,
                    'job_url': link,
                    'source': 'LinkedIn',
                    'posted': 'Last 24 hours'
                }

                if job['job_url']:
                    jobs.append(job)

        # Be respectful - random delay
        time.sleep(random.uniform(0.2, 0.5))

    except Exception as e:
        print(f"    Error: {str(e)[:100]}")

    return jobs

def run_search():
    """Run LinkedIn search and return new jobs"""
    print(f"🔗 Starting LinkedIn job search at {datetime.now()}")
    print(f"   Looking for jobs posted in last 24 hours")

    seen = load_seen()
    all_new = []

    for title in JOB_TITLES:
        for location in LOCATIONS:
            jobs = search_linkedin(title, location)

            for job in jobs:
                # Create unique ID
                jid = f"{job['source']}_{job['title']}_{job['company']}_{job['location']}"

                # Check if new
                if jid not in seen:
                    seen[jid] = datetime.now().isoformat()
                    all_new.append(job)

            time.sleep(0.1)  # Between searches

    save_seen(seen)
    print(f"\n📊 Found {len(all_new)} NEW jobs (deduplicated)")
    return all_new

def email_alert(jobs):
    """Send email alert with job listings"""
    cfg = load_cfg()
    if not cfg or not jobs:
        return

    html = f"""<!DOCTYPE html><html><head><style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .header {{ background: linear-gradient(135deg, #0077b5, #00a0dc); color: white; padding: 25px; border-radius: 10px; }}
        .summary {{ background: #fff3cd; padding: 15px; margin: 20px 0; border-left: 4px solid #ffc107; }}
        .job {{ margin: 15px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px; }}
        .btn {{ display: inline-block; margin-top: 10px; padding: 8px 16px; background: #0077b5; color: white; text-decoration: none; border-radius: 5px; }}
        .footer {{ color: #666; font-size: 12px; text-align: center; margin-top: 20px; }}
    </style></head><body>
    <div class="header">
        <h1>🔗 LINKEDIN .NET JOB ALERT</h1>
        <p>{datetime.now().strftime('%A, %B %d, %Y at %I:%M %p CDT')}</p>
    </div>
    <div class="summary">
        <strong>📌 {len(jobs)} new .NET jobs</strong> posted in the last 24 hours on LinkedIn.
    </div>
    """

    for j in jobs[:10]:  # Show top 10
        html += f"""<div class="job">
            <strong>{j['title']}</strong><br>
            🏢 {j['company']} | 📍 {j['location']}<br>
            <a href="{j['job_url']}" class="btn">Apply on LinkedIn →</a>
        </div>"""

    if len(jobs) > 10:
        html += f"<p><em>...and {len(jobs) - 10} more jobs in the full alert.</em></p>"

    html += """<div class="footer">
        <p>LinkedIn Job Scraper | Posted in Last 24 Hours</p>
    </div></body></html>"""

    msg = MIMEMultipart()
    msg["Subject"] = f"🔗 {len(jobs)} New .NET Jobs on LinkedIn (Last 24h)"
    msg["From"] = cfg["sender_email"]
    msg["To"] = cfg["recipient_email"]
    msg.attach(MIMEText(html, "html"))

    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ctx) as s:
            s.login(cfg["sender_email"], cfg["sender_password"])
            s.sendmail(cfg["sender_email"], cfg["recipient_email"], msg.as_string())
        print(f"✅ Email sent ({len(jobs)} jobs)")
    except Exception as e:
        print(f"❌ Email failed: {e}")

# ============ MAIN ============

if __name__ == "__main__":
    print("="*70)
    print("🔗 LINKEDIN .NET JOB SCRAPER (Email Only)")
    print("="*70)

    jobs = run_search()

    if jobs:
        print("\n📢 Sending email alert...")
        email_alert(jobs)
        print("\n✅ Done - email sent!")
    else:
        print("\nℹ️  No new jobs found this run")

    print("="*70)
