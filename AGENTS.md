<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:deploy-sop-rules -->
# Deploy SOP — READ BEFORE ANY BUILD/PUSH/DEPLOY TASK

Before performing any build, commit, push, or deploy action for this project, you MUST read the full SOP at:
`docs/sop-deploy.md`

Key rules to memorize:
- SSH alias is `vps` (never `hostinger` or a raw IP)
- VPS path: `/var/www/siddhantrangari`
- PM2 process name: `siddhantrangari`
- Deploy command: `ssh vps "cd /var/www/siddhantrangari && git pull origin main && npm run build && pm2 restart siddhantrangari"`
- If workshop markdown files changed, recompile FIRST: `python3 projects/myagentfirm/workshop/assemble_workshop.py`
- The VPS uses a scoped SSH deploy key (`github.com-siddhantrangari` alias) — do NOT change global SSH config

🚨 SSH SAFETY: Hostinger blocks IPs on repeated failed SSH attempts.
NEVER guess SSH aliases or IPs — `vps` is the only correct name.

Connect with plain `ssh vps '<command>'`. Do NOT prepend a connectivity probe
such as `ssh -o ConnectTimeout=5 -o BatchMode=yes vps 'echo ok'`, and do not add
`-o` flags — the alias is already configured and keyed, so the probe only adds a
round trip. If a command fails — STOP. Do not retry blindly.
<!-- END:deploy-sop-rules -->
