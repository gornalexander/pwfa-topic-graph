# PWFA graph editor — backend setup (one-time)

The editor needs a tiny Cloudflare Worker for two things a static site can't do
itself: GitHub OAuth (token exchange) and an Anthropic proxy (keeps the API key
off the browser). ~15 minutes.

## 1. Create a GitHub OAuth App
GitHub → Settings → Developer settings → **OAuth Apps** → **New OAuth App**
- Application name: `PWFA graph editor`
- Homepage URL: `https://gornalexander.github.io/pwfa-topic-graph/`
- Authorization callback URL: `https://<your-worker-subdomain>.workers.dev/auth/callback`
  (you'll get the worker URL in step 2; come back and set this)
- Create → note the **Client ID**, generate a **Client secret**.

## 2. Deploy the Worker
Install wrangler if needed: `npm i -g wrangler` then `wrangler login`.

From `editor/`:
```bash
wrangler deploy worker.js --name pwfa-editor --compatibility-date 2024-01-01
```
This prints your worker URL, e.g. `https://pwfa-editor.<you>.workers.dev`.
Put that callback URL back into the GitHub OAuth App (step 1).

Set vars + secrets:
```bash
wrangler secret put GITHUB_CLIENT_SECRET   # paste OAuth client secret
wrangler secret put ANTHROPIC_API_KEY      # paste Anthropic key
# vars (non-secret):
wrangler deploy worker.js --name pwfa-editor \
  --var GITHUB_CLIENT_ID:<client id> \
  --var ALLOWED_USER:gornalexander \
  --var ALLOWED_ORIGINS:"https://gornalexander.github.io,http://localhost:8080"
```
(Or set the vars in the Cloudflare dashboard → Worker → Settings → Variables.)

## 3. Point the site at the Worker
Edit `config.js` in the repo root:
```js
const CONFIG = {
  workerUrl: "https://pwfa-editor.<you>.workers.dev",
  owner: "gornalexander",
  repo: "pwfa-topic-graph",
  branch: "main",
  allowedUser: "gornalexander",
};
```
Commit & push. Done — the "Edit" button will now offer "Login with GitHub".

## Notes
- The OAuth scope is `repo read:user` so the editor can commit `papers.js` /
  `topics.js` directly from the browser using your token.
- The Worker only lets `ALLOWED_USER` use the AI draft endpoint.
- The GitHub token lives in `sessionStorage` (cleared when the tab closes).
- **AI reads the paper**: on draft, the Worker fetches the paper's metadata +
  abstract (arXiv API / Crossref) and a best-effort full-text excerpt (ar5iv for
  arXiv papers), and feeds that to the model — so drafts are grounded in the
  actual paper, not the model's memory. No extra setup needed.
