#!/usr/bin/env python3.12
"""HOURLY .NET JOB SEARCH - Runs all 4 batch types"""
import json, os, time, smtplib, ssl, requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pathlib import Path
from datetime import datetime
from jobspy import scrape_jobs

EMAIL_CONFIG = Path.home() / ".hermes" / "email_config.json"
SEEN_FILE = Path.home() / ".hermes" / "job-results" / "hourly_batch_seen.json"
TG_CHAT = os.environ.get("HERMES_TELEGRAM_CHAT_ID", "")
JOB_TITLES = [".NET Developer", "Senior .NET Developer", "C# Developer", ".NET Software Engineer", "Senior Software Engineer .NET", "Azure Developer"]
BATCH_CONFIGS = [
    {"name": "Consistent H1B", "location": "Remote", "titles": 2},
    {"name": "FY2025 Q4", "location": "Dallas, TX", "titles": 2},
    {"name": "Top 100 H1B", "location": "Texas", "titles": 2},
    {"name": "Texas Companies", "location": "United States", "titles": 2},
]

def load_cfg():
    return json.loads(EMAIL_CONFIG.read_text()) if EMAIL_CONFIG.exists() else None

def load_seen():
    return json.loads(SEEN_FILE.read_text()) if SEEN_FILE.exists() else {}

def save_seen(s):
    SEEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    SEEN_FILE.write_text(json.dumps(s, indent=2))

def search_linkedin(title, location):
    try:
        jobs = scrape_jobs(site_name=["linkedin"], search_term=title, location=location, results_wanted=15, hours_old=12, verbose=0)
        return [{"title": j.get("title"), "company": j.get("company"), "location": j.get("location"), "job_url": j.get("job_url"), "source": "LinkedIn", "batch": location} for _, j in jobs.iterrows()]
    except Exception as e:
        print(f"   Error: {e}")
        return []

def run_batch_search():
    print(f"📊 Starting hourly batch search at {datetime.now()}")
    seen = load_seen()
    all_new = []
    for batch in BATCH_CONFIGS:
        print(f"\n🔍 Running batch: {batch['name']} ({batch['location']})")
        hour = datetime.now().hour
        start_idx = hour % len(JOB_TITLES)
        titles = JOB_TITLES[start_idx:start_idx + batch['titles']]
        if len(titles) < batch['titles']:
            titles += JOB_TITLES[:batch['titles'] - len(titles)]
        for title in titles:
            print(f"   Searching '{title}'")
            jobs = search_linkedin(title, batch['location'])
            for job in jobs:
                jid = f"{job['source']}_{job['title']}_{job['company']}_{job['location']}"
                if jid not in seen:
                    seen[jid] = datetime.now().isoformat()
                    all_new.append(job)
            time.sleep(2)
    save_seen(seen)
    print(f"\n📊 Found {len(all_new)} new jobs")
    return all_new

def email_alert(jobs):
    cfg = load_cfg()
    if not cfg: return
    by_batch = {}
    for j in jobs:
        by_batch.setdefault(j.get('batch', 'Unknown'), []).append(j)
    html = f"<html><body style='font-family:Arial'><div style='background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:25px;border-radius:10px'><h1>📊 .NET JOB ALERT</h1><p>{datetime.now().strftime('%I:%M %p CDT')}</p></div><div style='background:#fff3cd;padding:15px;margin:20px 0;border-left:4px solid #ffc107'><strong>📈</strong> {len(jobs)} new jobs</div>"
    for batch, js in by_batch.items():
        html += f"<h2>{batch} ({len(js)} jobs)</h2>"
        for j in js[:8]:
            html += f"<div style='margin:15px 0;padding:15px;border:1px solid #ddd;border-radius:8px'><strong>{j['title']}</strong><br>🏢 {j['company']} | 📍 {j['location']}<br><a href='{j['job_url']}' style='display:inline-block;margin-top:10px;padding:8px 16px;background:#667eea;color:white;text-decoration:none;border-radius:5px'>Apply →</a></div>"
    html += "<p style='color:#666;font-size:12px;text-align:center'>Oracle Cloud VM</p></body></html>"
    msg = MIMEMultipart()
    msg["Subject"] = f"📊 {len(jobs)} New .NET Jobs"
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

def tg_alert(jobs):
    tfile = Path.home() / ".hermes" / "telegram_bot_token.txt"
    if not tfile.exists(): return
    token = tfile.read_text().strip()
    by_batch = {}
    for j in jobs:
        by_batch.setdefault(j.get('batch', 'Unknown'), []).append(j)
    msg = f"📊 **HOURLY BATCH**\n🕒 {datetime.now().strftime('%I:%M %p')}\n🔥 {len(jobs)} jobs\n\n"
    for batch, js in by_batch.items():
        msg += f"**{batch}** ({len(js)} jobs)\n"
        for j in js[:5]:
            msg += f"• {j['title']}\n  🏢 {j['company']} | 🔗 {j['job_url']}\n\n"
    try:
        requests.post(f"https://api.telegram.org/bot{token}/sendMessage", params={"chat_id": TG_CHAT, "text": msg, "parse_mode": "Markdown"}, timeout=10)
        print("✅ Telegram sent")
    except: pass

if __name__ == "__main__":
    print("="*60)
    print("📊 HOURLY BATCH JOB SEARCH")
    print("="*60)
    jobs = run_batch_search()
    if jobs:
        email_alert(jobs)
        tg_alert(jobs)
    print("="*60)
