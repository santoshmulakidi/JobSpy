# Oracle Free Tier Deployment

Deploy the Job Intelligence Platform on an Oracle Cloud Free Tier Ubuntu VM and access it from your PC.

## Recommended Setup

- Oracle Cloud Ubuntu VM
- Docker + Docker Compose
- Nginx container as the public entry point on port `80`
- FastAPI backend behind `/api`
- Next.js frontend on `/`
- SQLite database stored in a Docker volume

```text
Your PC
  -> http://<ORACLE_PUBLIC_IP>
  -> Nginx :80
  -> Next.js frontend :3000
  -> FastAPI backend :8000
  -> SQLite volume /data/job_intelligence.db
```

## 1. Open Oracle Network Access

In Oracle Cloud Console:

1. Go to the VM's VCN.
2. Open the subnet security list or network security group.
3. Add ingress rules:

```text
Source CIDR: 0.0.0.0/0
Protocol: TCP
Destination Port: 80
```

Optional, only if you want HTTPS later:

```text
Source CIDR: 0.0.0.0/0
Protocol: TCP
Destination Port: 443
```

Keep SSH restricted if possible:

```text
Source CIDR: <YOUR_HOME_PUBLIC_IP>/32
Protocol: TCP
Destination Port: 22
```

## 2. Install Docker On The VM

SSH into the Oracle VM:

```bash
ssh ubuntu@<ORACLE_PUBLIC_IP>
```

Install Docker:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in so Docker group permissions apply:

```bash
exit
ssh ubuntu@<ORACLE_PUBLIC_IP>
```

Verify:

```bash
docker --version
docker compose version
```

## 3. Clone Or Update The Repo

Clone:

```bash
git clone https://github.com/santoshmulakidi/JobSpy.git
cd JobSpy/job-intelligence
```

If already cloned:

```bash
cd ~/JobSpy
git pull origin main
cd job-intelligence
```

## 4. Create Production `.env`

```bash
cp .env.example .env
nano .env
```

Minimum values:

```env
JOB_INTELLIGENCE_DATABASE_URL=sqlite:////data/job_intelligence.db
JOB_INTELLIGENCE_LOG_LEVEL=INFO
JOB_INTELLIGENCE_SCHEDULER_HOURS=1
JOB_INTELLIGENCE_CORS_ORIGINS=http://<ORACLE_PUBLIC_IP>,http://localhost:3000,http://127.0.0.1:3000
JOB_INTELLIGENCE_DEFAULT_SITES=linkedin,indeed,google,career_page,jobright_h1b,dice,governmentjobs,adzuna,remoteok,jobspresso,dynamitejobs,skipthedrive,remotive,remotely,yc_jobs
```

Add AI keys only on the VM, never commit them:

```env
JOB_INTELLIGENCE_AI_PROVIDER_ORDER=gemini,groq,openrouter,nvidia
JOB_INTELLIGENCE_GEMINI_API_KEY=
JOB_INTELLIGENCE_GROQ_API_KEY=
JOB_INTELLIGENCE_OPENROUTER_API_KEY=
JOB_INTELLIGENCE_NVIDIA_API_KEY=
```

USAJobs is optional:

```env
JOB_INTELLIGENCE_ADZUNA_APP_ID=
JOB_INTELLIGENCE_ADZUNA_APP_KEY=
```

## 5. Build And Start

From `~/JobSpy/job-intelligence`:

```bash
docker compose up -d --build
```

Check containers:

```bash
docker compose ps
```

Check logs:

```bash
docker compose logs -f nginx
docker compose logs -f api
docker compose logs -f scheduler
docker compose logs -f frontend
```

## 6. Access From Your PC

Open:

```text
http://<ORACLE_PUBLIC_IP>
```

Health check:

```text
http://<ORACLE_PUBLIC_IP>/api/health
```

API docs:

```text
http://<ORACLE_PUBLIC_IP>/api/docs
```

## 7. Update Deployment After Git Push

On the VM:

```bash
cd ~/JobSpy
git pull origin main
cd job-intelligence
docker compose up -d --build
docker compose ps
```

## 8. Backup SQLite Data

The database lives in the Docker volume `job-intelligence_db-data`.

Manual backup:

```bash
mkdir -p ~/job-intelligence-backups
docker run --rm \
  -v job-intelligence_db-data:/data:ro \
  -v ~/job-intelligence-backups:/backup \
  alpine sh -c 'cp /data/job_intelligence.db /backup/job_intelligence-$(date +%Y%m%d-%H%M%S).db'
```

List backups:

```bash
ls -lh ~/job-intelligence-backups
```

## 9. Troubleshooting

If the site does not open:

```bash
docker compose ps
docker compose logs --tail=100 nginx
docker compose logs --tail=100 frontend
docker compose logs --tail=100 api
```

Check Ubuntu firewall:

```bash
sudo ufw status
```

If UFW is active:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

Check Oracle security rules if port `80` is still blocked.

## 10. Private Access Option

If you do not want the app public, do not open port `80`. Use SSH tunneling:

```bash
ssh -L 3000:localhost:80 ubuntu@<ORACLE_PUBLIC_IP>
```

Then open on your PC:

```text
http://localhost:3000
```
