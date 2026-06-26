# Live deployment (VPS, subscription-based AI)

The editor backend runs on the VPS (sadco.info / 77.83.87.74), not Cloudflare.
AI drafting uses **Claude Code with the subscription** (no Anthropic API key).

## What's running
- **Endpoint:** https://77-83-87-74.nip.io  (Let's Encrypt TLS, auto-renew)
  - `nip.io` wildcard DNS maps the host to the VPS IP, so no registrar change
    was needed. Switch to `editor.sadco.info` later once that DNS is set.
- **Service:** `systemd` unit `pwfa-editor` runs `node /opt/pwfa-editor/server.mjs`
  as the non-root user `pwfaedit`, listening on 127.0.0.1:8787.
- **nginx:** vhost `/etc/nginx/sites-available/pwfa-editor` reverse-proxies the
  host to the node service (TLS terminated by nginx).
- **Files on VPS:** `/opt/pwfa-editor/{worker.mjs,server.mjs}` (copied from this
  repo's `editor/worker.js` → `worker.mjs`, and `editor/server.mjs`).

## Config — /etc/pwfa-editor.env  (chmod 600, owned by pwfaedit)
    PORT=8787
    PUBLIC_ORIGIN=https://77-83-87-74.nip.io
    ALLOWED_USER=gornalexander
    ALLOWED_ORIGINS=https://gornalexander.github.io,http://localhost:8080
    GITHUB_CLIENT_ID=<oauth app client id>
    GITHUB_CLIENT_SECRET=<oauth app client secret>
    CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token` on a subscriber machine>
    HOME=/opt/pwfa-editor/home

## How AI drafting works
`/ai/draft` (server.mjs) verifies the GitHub token is `gornalexander`, fetches
the paper (arXiv API / Crossref + ar5iv full text), builds a prompt, and runs
`claude -p <prompt>` with `CLAUDE_CODE_OAUTH_TOKEN` — i.e. it uses the Claude
subscription, not the paid API. `/auth/*` (OAuth) is handled by worker.mjs.

## Redeploy after editing worker.js / server.mjs
    cd editor
    scp worker.js  vps:/opt/pwfa-editor/worker.mjs
    scp server.mjs vps:/opt/pwfa-editor/server.mjs
    ssh vps 'chown pwfaedit:pwfaedit /opt/pwfa-editor/*.mjs && systemctl restart pwfa-editor'

## Rotate the Claude token
Run `claude setup-token` again, then update CLAUDE_CODE_OAUTH_TOKEN in the env
file and `systemctl restart pwfa-editor`.

## Logs
    ssh vps 'journalctl -u pwfa-editor -n 50 --no-pager'
