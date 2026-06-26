// Cloudflare Worker for the PWFA graph editor.
//
// Provides two things a static site can't do on its own:
//   1. GitHub OAuth token exchange (needs the client secret server-side)
//   2. An Anthropic proxy for AI paper drafting (keeps the API key off the client)
//
// Deploy: see editor/README.md. Required secrets/vars (wrangler):
//   GITHUB_CLIENT_ID      (var)    OAuth app client id
//   GITHUB_CLIENT_SECRET  (secret) OAuth app client secret
//   ANTHROPIC_API_KEY     (secret) Anthropic API key
//   ALLOWED_USER          (var)    GitHub login allowed to edit (e.g. gornalexander)
//   ALLOWED_ORIGINS       (var)    comma-separated, e.g. "https://gornalexander.github.io,http://localhost:8080"

const AI_MODEL = "claude-opus-4-8";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    try {
      if (url.pathname === "/auth/login") return handleLogin(url, env);
      if (url.pathname === "/auth/callback") return handleCallback(url, env);
      if (url.pathname === "/ai/draft") return handleDraft(request, env, cors);
      return json({ error: "not found" }, 404, cors);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500, cors);
    }
  },
};

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : (allowed[0] || "*"),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

// --- OAuth: step 1, redirect to GitHub ---
function handleLogin(url, env) {
  const redirectUri = `${url.origin}/auth/callback`;
  const state = url.searchParams.get("state") || "";
  const gh = new URL("https://github.com/login/oauth/authorize");
  gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  gh.searchParams.set("redirect_uri", redirectUri);
  gh.searchParams.set("scope", "repo read:user");
  gh.searchParams.set("state", state);
  return Response.redirect(gh.toString(), 302);
}

// --- OAuth: step 2, exchange code, hand token to the opener via postMessage ---
async function handleCallback(url, env) {
  const code = url.searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });

  const resp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const data = await resp.json();
  const token = data.access_token || "";

  // Small page that posts the token back to the opener window, then closes.
  const html = `<!doctype html><meta charset="utf-8"><body style="background:#0a0e1a;color:#e0e4ef;font-family:system-ui">
<script>
  (function () {
    var token = ${JSON.stringify(token)};
    if (window.opener) {
      window.opener.postMessage({ type: "pwfa-oauth", token: token }, "*");
      window.close();
    } else {
      document.body.textContent = token ? "Login complete — you can close this tab." : "Login failed.";
    }
  })();
</script></body>`;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

// --- AI draft: verify caller, then call Anthropic ---
async function handleDraft(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

  const auth = request.headers.get("Authorization") || "";
  const ghToken = auth.replace(/^Bearer\s+/i, "");
  if (!ghToken) return json({ error: "missing GitHub token" }, 401, cors);

  // Verify the token belongs to the allowed user.
  const userResp = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${ghToken}`, "User-Agent": "pwfa-editor", Accept: "application/vnd.github+json" },
  });
  if (!userResp.ok) return json({ error: "invalid GitHub token" }, 401, cors);
  const user = await userResp.json();
  if (user.login !== env.ALLOWED_USER) {
    return json({ error: `user ${user.login} not allowed` }, 403, cors);
  }

  const body = await request.json();
  const prompt = buildDraftPrompt(body);

  const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!aiResp.ok) {
    const t = await aiResp.text();
    return json({ error: "anthropic error", detail: t }, 502, cors);
  }
  const ai = await aiResp.json();
  const text = (ai.content || []).map(c => c.text || "").join("");

  // Extract the JSON object from the model's reply.
  let draft;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    draft = JSON.parse(m ? m[0] : text);
  } catch (e) {
    return json({ error: "could not parse AI output", raw: text }, 502, cors);
  }
  return json({ draft }, 200, cors);
}

function buildDraftPrompt(body) {
  const { link, existingTopicIds = [], existingTags = [] } = body;
  return `You are helping build an interactive graph of research topics in proton-driven plasma wakefield acceleration (PWFA).

A paper link was provided: ${link}

Using your knowledge of this paper (and the link), produce a JSON object describing how it fits the graph. Return ONLY valid JSON, no prose.

Shape:
{
  "paper": {
    "id": "Journal.Volume.PageOrArticleId",   // e.g. "PoP.29.023104"
    "title": "...",
    "ref": "FirstAuthor et al., Journal Vol, Page (Year)",
    "authors": "Surname1, Surname2, ...",
    "doi": "10....." or null,
    "arxiv": "NNNN.NNNNN" or null,
    "me": "first" | "coauthor" | null            // is "Gorn" an author? first author?
  },
  "topic": {
    "id": "short_snake_case_id",
    "label": "Two line\\nLabel",
    "status": "solved" | "partial" | "unsolved",
    "tags": ["theory","experiment","simulation"],  // subset
    "description": "2-4 sentence explanation.",
    "openQuestions": "..." or null,
    "sources": [{ "id": "<existing topic id>", "type": "relationship" }]
  },
  "attachToExisting": "<existing topic id>" or null  // if the paper belongs to an existing topic instead of a new one
}

Existing topic ids you may reference in sources or attachToExisting: ${existingTopicIds.join(", ")}.
Existing tags in use: ${existingTags.join(", ")}.
Prefer reusing existing topics when the paper fits one. Keep ids lowercase snake_case.`;
}
