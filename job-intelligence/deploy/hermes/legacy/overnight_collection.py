#!/usr/bin/env python3.12
"""OVERNIGHT JOB COLLECTION - 7 AM CDT daily"""
import json, os, time, smtplib, ssl, requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pathlib import Path
from datetime import datetime
from jobspy import scrape_jobs

EMAIL_CONFIG = Path.home() / ".hermes" / "email_config.json"
SEEN_FILE = Path.home() / ".hermes" / "job-results" / "overnight_seen.json"
TG_CHAT = os.environ.get("HERMES_TELEGRAM_CHAT_ID", "")
JOB_TITLES = [".NET Developer", "Senior .NET Developer", "C# Developer", ".NET Software Engineer", "Senior Software Engineer .NET", "Azure Developer"]

def load_cfg():
    return json.loads(EMAIL_CONFIG.read_text()) if EMAIL_CONFIG.exists() else None
def load_seen():
    return json.loads(SEEN_FILE.read_text()) if SEEN_FILE.exists() else {}
def save_seen(s):
    SEEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    SEEN_FILE.write_text(json.dumps(s, indent=2))

def search_linkedin(title):
    try:
        jobs = scrape_jobs(site_name=["linkedin"], search_term=title, location="Remote", results_wanted=20, hours_old=12, verbose=0)
        return [{"title": j.get("title"), "company": j.get("company"), "location": j.get("location"), "job_url": j.get("job_url"), "source": "LinkedIn"} for _, j in jobs.iterrows()]
    except: return []

def run_overnight_search():
    print(f"🌙 Starting overnight collection at {datetime.now()}")
    seen = load_seen()
    all_new = []
    for title in JOB_TITLES:
        print(f"   Searching '{title}'")
        for job in search_linkedin(title):
            jid = f"ON_{job['title']}_{job['company']}"
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
    html = f"<html><body style='font-family:Arial'><div style='background:linear-gradient(135deg,#1e3c72,#2a5298);color:white;padding:25px;border-radius:10px'><h1>🌅 Morning Briefing</h1><p>{datetime.now().strftime('%I:%M %p CDT')}</p></div><div style='background:#e8f5e9;padding:15px;margin:20px 0;border-left:4px solid #4caf50'><strong>☕</strong> {len(jobs)} overnight jobs</div>"
    for j in jobs[:15]:
        html += f"<div style='margin:15px 0;padding:15px;border:1px solid #ddd;border-radius:8px'><strong>{j['title']}</strong><br>🏢 {j['company']} | 📍 {j['location']}<br><a href='{j['job_url']}' style='background:#1e3c72;color:white;padding:8px 16px;text-decoration:none;border-radius:5px;display:inline-block;margin-top:10px'>Apply →</a></div>"
    html += "<p style='color:#666;font-size:12px;text-align:center'>Oracle VM</p></body></html>"
    msg = MIMEMultipart()
    msg["Subject"] = f"🌅 {len(jobs)} Overnight Jobs"
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

def tg_alert(jobs):
    tfile = Path.home() / ".hermes" / "telegram_bot_token.txt"
    if not tfile.exists(): return
    msg = f"🌅 **Morning Briefing**\n{len(jobs)} overnight jobs\n\n"
    for j in jobs[:10]:
        msg += f"• {j['title']}\n  🏢 {j['company']} | 🔗 {j['job_url']}\n\n"
    try:
        requests.post(f"https://api.telegram.org/bot{tfile.read_text().strip()}/sendMessage", params={"chat_id": TG_CHAT, "text": msg, "parse_mode": "Markdown"}, timeout=10)
    except: pass

if __name__ == "__main__":
    print("="*60)
    print("🌅 OVERNIGHT COLLECTION")
    jobs = run_overnight_search()
    if jobs:
        email_alert(jobs)
        tg_alert(jobs)
