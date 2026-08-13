#!/usr/bin/env python3.12
"""WEEKEND JOB COLLECTION - 10 AM CDT Sat/Sun"""
import json, os, time, smtplib, ssl, requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pathlib import Path
from datetime import datetime
from jobspy import scrape_jobs

EMAIL_CONFIG = Path.home() / ".hermes" / "email_config.json"
SEEN_FILE = Path.home() / ".hermes" / "job-results" / "weekend_seen.json"
TG_CHAT = os.environ.get("HERMES_TELEGRAM_CHAT_ID", "")
JOB_TITLES = [".NET Developer", "Senior .NET Developer", "C# Developer", ".NET Software Engineer"]

def load_cfg():
    return json.loads(EMAIL_CONFIG.read_text()) if EMAIL_CONFIG.exists() else None
def load_seen():
    return json.loads(SEEN_FILE.read_text()) if SEEN_FILE.exists() else {}
def save_seen(s):
    SEEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    SEEN_FILE.write_text(json.dumps(s, indent=2))

def search_linkedin(title):
    try:
        jobs = scrape_jobs(site_name=["linkedin"], search_term=title, location="Remote", results_wanted=20, hours_old=48, verbose=0)
        return [{"title": j.get("title"), "company": j.get("company"), "location": j.get("location"), "job_url": j.get("job_url"), "source": "LinkedIn"} for _, j in jobs.iterrows()]
    except: return []

def run_search():
    print(f"📅 Weekend collection at {datetime.now()}")
    seen = load_seen()
    all_new = []
    for title in JOB_TITLES:
        for job in search_linkedin(title):
            jid = f"WE_{job['title']}_{job['company']}"
            if jid not in seen:
                seen[jid] = datetime.now().isoformat()
                all_new.append(job)
        time.sleep(2)
    save_seen(seen)
    print(f"Found {len(all_new)} jobs")
    return all_new

def email_alert(jobs):
    cfg = load_cfg()
    if not cfg: return
    html = f"<html><body style='font-family:Arial'><div style='background:linear-gradient(135deg,#f093fb,#f5576c);color:white;padding:25px;border-radius:10px'><h1>📅 Weekend Jobs</h1></div><div style='padding:15px'><strong>{len(jobs)} jobs in 48h</strong></div>"
    for j in jobs[:12]:
        html += f"<div style='margin:15px 0;padding:15px;border:1px solid #ddd'><strong>{j['title']}</strong><br>🏢 {j['company']} | {j['location']}<br><a href='{j['job_url']}' style='background:#f5576c;color:white;padding:8px 16px;text-decoration:none;border-radius:5px;display:inline-block;margin-top:10px'>Apply →</a></div>"
    html = f"""<html><body><h2>📅 Weekend Jobs ({len(jobs)})</h2>"""
    for j in jobs[:12]:
        html += f"<div><b>{j['title']}</b> - {j['company']}<br><a href='{j['job_url']}'>Apply</a></div>"
    msg = MIMEMultipart()
    msg["Subject"] = f"📅 {len(jobs)} Weekend Jobs"
    msg["From"] = cfg["sender_email"]
    msg["To"] = cfg["recipient_email"]
    msg.attach(MIMEText(html, "html"))
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
            s.login(cfg["sender_email"], cfg["sender_password"])
            s.sendmail(cfg["sender_email"], cfg["recipient_email"], msg.as_string())
        print("✅ Email sent")
    except Exception as e:
        print(f"❌ Failed: {e}")

if __name__ == "__main__":
    jobs = run_search()
    if jobs:
        email_alert(jobs)
