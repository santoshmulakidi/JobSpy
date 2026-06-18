# Job Intelligence Platform — Claude instructions

See `jobspy.md` for full architecture and operations reference.

## Deploy trigger

When the user says **"deploy"** (or "deploy to VM", "push to VM", "deploy latest"), execute the full deployment sequence from `jobspy.md` automatically:

1. `git status` + `git log --oneline -3` locally
2. SSH pull + `docker compose down --remove-orphans && docker compose up -d --build`
3. `docker compose ps` to confirm containers running
4. Health-check: `curl http://localhost/api/health` on VM, then public `curl http://163.192.111.51/api/health`
5. On 502: restart nginx container, retry health check

SSH: `ssh -i ~/.ssh/ssh-key-2026-05-28.key ubuntu@163.192.111.51`  
Repo on VM: `~/JobSpy/job-intelligence`

Never expose `.env` contents. Ignore untracked scratch files.
