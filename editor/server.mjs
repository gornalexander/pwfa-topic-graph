// Node host for the editor backend on the VPS.
// - /auth/* (OAuth) is handled by worker.mjs's fetch().
// - /ai/draft is handled here: reads the paper, then drafts via the Claude CLI
//   (Claude Code, authenticated by the subscription token CLAUDE_CODE_OAUTH_TOKEN)
//   instead of the paid Anthropic API.
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { spawn } from "node:child_process";
import worker, {
  corsHeaders, json, verifyAllowedUser,
  parseLink, fetchArxiv, fetchCrossref, fetchFullText, buildDraftPrompt,
} from "./worker.mjs";

const PAPERS_DIR = process.env.PAPERS_DIR || "/srv/papers";
const ARXIV_CACHE = `${PAPERS_DIR}/cache/arxiv`;

const PORT = process.env.PORT || 8787;
const env = {
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || "",
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || "",
  ALLOWED_USER: process.env.ALLOWED_USER || "gornalexander",
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "",
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN || "",
  CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || "",
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// Run the Claude CLI in headless mode using the subscription token.
// --tools "": disable ALL tools, so the model only generates text from the
// paper content we already fetched (no web-fetch/Bash, no permission prompts,
// so it can't hang or run anything). Hard timeout kills a stuck process.
function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", [
      "-p", prompt,
      "--output-format", "text",
      "--tools", "",
    ], {
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN,
        HOME: process.env.HOME || "/opt/pwfa-editor/home",
      },
    });
    let out = "", err = "", done = false;
    const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(timer); fn(arg); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(reject, new Error("claude timed out")); }, 120000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => finish(reject, e));
    child.on("close", (code) =>
      code === 0 ? finish(resolve, out) : finish(reject, new Error(err || `claude exited ${code}`)));
  });
}

// Only one draft at a time — a stuck/slow draft can never stack up and starve
// the box (each claude run is heavy).
let draftInFlight = false;

async function handleDraftCLI(request, cors) {
  const auth = request.headers.get("Authorization") || "";
  const ghToken = auth.replace(/^Bearer\s+/i, "");
  const v = await verifyAllowedUser(ghToken, env);
  if (!v.ok) return json({ error: v.error }, v.status, cors);

  if (draftInFlight) {
    return json({ error: "busy — another draft is in progress, try again in a moment" }, 429, cors);
  }
  draftInFlight = true;
  try {
    return await runDraft(request, cors);
  } finally {
    draftInFlight = false;
  }
}

async function runDraft(request, cors) {
  const body = await request.json();
  const ids = parseLink(body.link || "");
  let meta = {}, fullText = null;
  if (ids.arxiv) {
    meta = await fetchArxiv(ids.arxiv).catch(() => ({ arxiv: ids.arxiv }));
    if (!meta.doi && ids.doi) meta.doi = ids.doi;
    fullText = await fetchFullText(ids.arxiv).catch(() => null);
  } else if (ids.doi) {
    meta = await fetchCrossref(ids.doi).catch(() => ({ doi: ids.doi }));
  }

  const prompt = buildDraftPrompt(body, meta, fullText) +
    "\n\nReturn ONLY the JSON object, nothing else.";

  let text;
  try {
    text = await runClaude(prompt);
  } catch (e) {
    return json({ error: "claude error: " + e.message }, 502, cors);
  }
  let draft;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    draft = JSON.parse(m ? m[0] : text);
  } catch (e) {
    return json({ error: "could not parse AI output", raw: text }, 502, cors);
  }
  return json({ draft }, 200, cors);
}

// --- Public arXiv PDF proxy (open access): fetch once, cache, serve inline ---
function validArxivId(id) {
  return /^[0-9]{4}\.[0-9]{4,6}(v[0-9]+)?$/.test(id) || /^[a-z.-]+\/[0-9]{7}(v[0-9]+)?$/i.test(id);
}
async function serveArxivPdf(rawId, res) {
  const id = decodeURIComponent(rawId).replace(/\.pdf$/i, "").trim();
  if (!validArxivId(id)) { res.writeHead(400); return res.end("bad arxiv id"); }
  const safe = id.replace(/[^a-z0-9.]/gi, "_");
  const file = `${ARXIV_CACHE}/${safe}.pdf`;
  let cached = true;
  try { await fsp.access(file); } catch { cached = false; }
  if (!cached) {
    try {
      const r = await fetch(`https://arxiv.org/pdf/${id}`, {
        headers: { "User-Agent": "pwfa-editor (paper preview)" }, redirect: "follow",
      });
      if (!r.ok) { res.writeHead(502); return res.end("arxiv fetch failed"); }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.subarray(0, 4).toString("latin1") !== "%PDF") { res.writeHead(502); return res.end("not a pdf yet"); }
      await fsp.mkdir(ARXIV_CACHE, { recursive: true });
      await fsp.writeFile(file, buf);
    } catch (e) {
      res.writeHead(502); return res.end("fetch error: " + e.message);
    }
  }
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${safe}.pdf"`,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=86400",
  });
  fs.createReadStream(file).pipe(res);
}

// --- Article info (abstract + figures), cached as JSON. Public. ---
const ARTICLE_CACHE = `${PAPERS_DIR}/cache/article`;

async function extractFiguresAr5iv(id) {
  try {
    const r = await fetch(`https://ar5iv.org/abs/${id}`, { headers: { "User-Agent": "pwfa-editor" }, redirect: "follow" });
    if (!r.ok) return [];
    const html = await r.text();
    const figs = [...html.matchAll(/<img[^>]+src="(\/html\/[^"]+\/assets\/[^"]+\.(?:png|jpe?g|svg|gif))"/gi)]
      .map(m => "https://ar5iv.org" + m[1]);
    return [...new Set(figs)];
  } catch { return []; }
}

async function serveArticle(kind, raw, origin, cors, res) {
  const key = (kind + "_" + decodeURIComponent(raw)).replace(/[^a-z0-9._-]/gi, "_");
  const file = `${ARTICLE_CACHE}/${key}.json`;
  try {
    const cached = await fsp.readFile(file, "utf8");
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    return res.end(cached);
  } catch { /* not cached, build it */ }

  let out = { abstract: null, title: null, authors: [], figures: [], pdf: null };
  try {
    if (kind === "arxiv") {
      const id = decodeURIComponent(raw);
      const meta = await fetchArxiv(id).catch(() => ({}));
      const figures = await extractFiguresAr5iv(id);
      out = {
        title: meta.title || null, authors: meta.authors || [],
        abstract: meta.abstract || null, figures,
        pdf: `${origin.replace(/\/$/, "")}/pdf/arxiv/${encodeURIComponent(id)}`,
      };
    } else if (kind === "doi") {
      const meta = await fetchCrossref(decodeURIComponent(raw)).catch(() => ({}));
      out = { title: meta.title || null, authors: meta.authors || [], abstract: meta.abstract || null, figures: [], pdf: null };
    }
  } catch (e) { out.error = e.message; }

  const body = JSON.stringify(out);
  try { await fsp.mkdir(ARTICLE_CACHE, { recursive: true }); await fsp.writeFile(file, body); } catch {}
  res.writeHead(200, { "Content-Type": "application/json", ...cors });
  res.end(body);
}

http.createServer(async (req, res) => {
  try {
    const origin = env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
    const url = origin.replace(/\/$/, "") + req.url;
    const pubCors = { "Access-Control-Allow-Origin": "*" };

    // Public arXiv PDF proxy — handled directly (streams a file).
    if (req.method === "GET" && req.url.startsWith("/pdf/arxiv/")) {
      return serveArxivPdf(req.url.slice("/pdf/arxiv/".length), res);
    }
    // Public article info (abstract + figures).
    if (req.method === "GET" && req.url.startsWith("/article/arxiv/")) {
      return serveArticle("arxiv", req.url.slice("/article/arxiv/".length), origin, pubCors, res);
    }
    if (req.method === "GET" && req.url.startsWith("/article/doi/")) {
      return serveArticle("doi", req.url.slice("/article/doi/".length), origin, pubCors, res);
    }

    const hasBody = !["GET", "HEAD"].includes(req.method);
    const bodyBuf = hasBody ? await readBody(req) : undefined;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: bodyBuf && bodyBuf.length ? bodyBuf : undefined,
    });

    const u = new URL(url);
    let resp;
    if (u.pathname === "/ai/draft" && req.method === "OPTIONS") {
      resp = new Response(null, { headers: corsHeaders(req.headers.origin || "", env) });
    } else if (u.pathname === "/ai/draft") {
      resp = await handleDraftCLI(request, corsHeaders(req.headers.origin || "", env));
    } else {
      resp = await worker.fetch(request, env); // /auth/* etc.
    }

    const headers = {};
    resp.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(resp.status, headers);
    res.end(Buffer.from(await resp.arrayBuffer()));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err && err.message || err) }));
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`pwfa-editor backend on 127.0.0.1:${PORT}`);
});
