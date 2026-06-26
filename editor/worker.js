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

  // Read the paper: fetch metadata + abstract (+ full text when available).
  const ids = parseLink(body.link || "");
  let meta = {}, fullText = null;
  if (ids.arxiv) {
    meta = await fetchArxiv(ids.arxiv).catch(() => ({ arxiv: ids.arxiv }));
    if (!meta.doi && ids.doi) meta.doi = ids.doi;
    fullText = await fetchFullText(ids.arxiv).catch(() => null);
  } else if (ids.doi) {
    meta = await fetchCrossref(ids.doi).catch(() => ({ doi: ids.doi }));
  }

  const prompt = buildDraftPrompt(body, meta, fullText);

  const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 1800,
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

// ---------- paper fetching ("read the paper") ----------

function parseLink(link) {
  link = (link || "").trim();
  let m = link.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})/i)
       || link.match(/arxiv\.org\/(?:abs|pdf)\/([a-z\-]+\/\d{7})/i)
       || link.match(/^([0-9]{4}\.[0-9]{4,5})(v\d+)?$/i);
  if (m) return { arxiv: m[1] };
  const d = link.match(/(10\.\d{4,9}\/[^\s"'<>]+)/i);
  if (d) return { doi: d[1].replace(/[.,);]+$/, "") };
  return {};
}

function decodeEntities(s) {
  return (s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
}
function stripTags(html) {
  return decodeEntities(
    (html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

async function fetchArxiv(id) {
  const r = await fetch(`https://export.arxiv.org/api/query?id_list=${id}`, {
    headers: { "User-Agent": "pwfa-editor" },
  });
  const xml = await r.text();
  const entry = (xml.match(/<entry>([\s\S]*?)<\/entry>/) || [])[1] || xml;
  const pick = re => { const m = entry.match(re); return m ? stripTags(m[1]) : null; };
  const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(m => stripTags(m[1]));
  const published = pick(/<published>([\s\S]*?)<\/published>/);
  return {
    title: pick(/<title>([\s\S]*?)<\/title>/),
    abstract: pick(/<summary>([\s\S]*?)<\/summary>/),
    authors,
    year: published ? published.slice(0, 4) : null,
    doi: pick(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/),
    journal: pick(/<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/),
    arxiv: id,
  };
}

async function fetchCrossref(doi) {
  const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: { "User-Agent": "pwfa-editor (mailto:gornalexander@gmail.com)" },
  });
  if (!r.ok) return { doi };
  const j = (await r.json()).message;
  return {
    title: Array.isArray(j.title) ? j.title[0] : j.title,
    abstract: j.abstract ? stripTags(j.abstract) : null,
    authors: (j.author || []).map(a => a.family || a.name).filter(Boolean),
    journal: (j["container-title"] || [])[0] || null,
    volume: j.volume || null,
    page: j.page || j["article-number"] || null,
    year: (j.published && j.published["date-parts"] && j.published["date-parts"][0][0])
      || (j.created && j.created["date-parts"] && j.created["date-parts"][0][0]) || null,
    doi,
  };
}

// Best-effort full text from the arXiv HTML (ar5iv). Falls back to null.
async function fetchFullText(arxivId) {
  const r = await fetch(`https://ar5iv.org/abs/${arxivId}`, {
    headers: { "User-Agent": "pwfa-editor" },
    redirect: "follow",
  });
  if (!r.ok) return null;
  const html = await r.text();
  const body = (html.match(/<article[\s\S]*?<\/article>/i) || [])[0] || html;
  const text = stripTags(body);
  return text.length > 400 ? text.slice(0, 14000) : null;
}

function buildDraftPrompt(body, meta = {}, fullText = null) {
  const { link, existingTopicIds = [], existingTags = [] } = body;
  const metaLines = [
    meta.title ? `Title: ${meta.title}` : "",
    meta.authors && meta.authors.length ? `Authors: ${meta.authors.join(", ")}` : "",
    meta.journal ? `Journal: ${meta.journal}${meta.volume ? " " + meta.volume : ""}${meta.page ? ", " + meta.page : ""}` : "",
    meta.year ? `Year: ${meta.year}` : "",
    meta.doi ? `DOI: ${meta.doi}` : "",
    meta.arxiv ? `arXiv: ${meta.arxiv}` : "",
    meta.abstract ? `Abstract: ${meta.abstract}` : "",
  ].filter(Boolean).join("\n");

  const paperBlock = (metaLines || fullText)
    ? `\n\n--- FETCHED PAPER CONTENT (base your answer on THIS, not memory) ---\n${metaLines}` +
      (fullText ? `\n\nFull text (excerpt):\n${fullText}` : "") +
      `\n--- END PAPER CONTENT ---\n`
    : `\n\n(No content could be fetched; use your knowledge of the paper.)\n`;

  return `You are helping build an interactive graph of research topics in proton-driven plasma wakefield acceleration (PWFA).

A paper link was provided: ${link}
${paperBlock}
Read the fetched content above and produce a JSON object describing how this paper fits the graph. Return ONLY valid JSON, no prose.

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
