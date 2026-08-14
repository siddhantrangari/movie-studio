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
NEVER guess SSH aliases or IPs. ALWAYS verify with `cat ~/.ssh/config | grep -A5 'Host vps'`
and run `ssh -o ConnectTimeout=5 -o BatchMode=yes vps 'echo ok'` before any deploy command.
If it fails — STOP. Do not retry blindly.
<!-- END:deploy-sop-rules -->
