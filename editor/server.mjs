// Node host for the editor backend on the VPS.
// - /auth/* (OAuth) is handled by worker.mjs's fetch().
// - /ai/draft is handled here: reads the paper, then drafts via the Claude CLI
//   (Claude Code, authenticated by the subscription token CLAUDE_CODE_OAUTH_TOKEN)
//   instead of the paid Anthropic API.
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

// --- High-quality figures from the arXiv source tarball ---
const FIG_CACHE = `${PAPERS_DIR}/cache/figs`;   // /figs/<id>/NN.png + manifest.json

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
    let err = "";
    p.stderr?.on("data", d => (err += d));
    p.on("close", code => resolve({ code, err }));
    p.on("error", e => resolve({ code: -1, err: e.message }));
  });
}

// Download source, follow \includegraphics order, convert each figure to a
// high-res PNG, cache under /figs/<id>/. Returns served URLs (empty on failure).
async function prepareFigures(id, origin) {
  const safe = id.replace(/[^a-z0-9.]/gi, "_");
  const dir = `${FIG_CACHE}/${safe}`;
  const base = origin.replace(/\/$/, "");
  try {
    const m = JSON.parse(await fsp.readFile(`${dir}/manifest.json`, "utf8"));
    return m.map(f => `${base}/fig/arxiv/${encodeURIComponent(id)}/${f}`);
  } catch { /* build */ }

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "arx-"));
  try {
    const r = await fetch(`https://arxiv.org/e-print/${id}`, { headers: { "User-Agent": "pwfa-editor" }, redirect: "follow" });
    if (!r.ok) throw new Error("eprint " + r.status);
    const tgz = `${tmp}/src.tar.gz`;
    await fsp.writeFile(tgz, Buffer.from(await r.arrayBuffer()));
    if ((await run("tar", ["xzf", tgz, "-C", tmp])).code !== 0) throw new Error("not a tarball");

    const all = await fsp.readdir(tmp, { recursive: true });
    const byRel = new Map(), byBase = new Map();
    for (const rel of all) {
      const low = rel.toLowerCase().replace(/^\.\//, "");
      byRel.set(low, path.join(tmp, rel));
      const b = path.basename(low);
      if (!byBase.has(b)) byBase.set(b, path.join(tmp, rel));
    }
    // collect \includegraphics targets in document order
    const texFiles = all.filter(f => f.toLowerCase().endsWith(".tex"));
    const targets = [];
    for (const tf of texFiles) {
      const tex = await fsp.readFile(path.join(tmp, tf), "utf8").catch(() => "");
      for (const m of tex.matchAll(/\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
        const t = m[1].trim();
        if (!targets.includes(t)) targets.push(t);
      }
    }
    const exts = ["", ".pdf", ".png", ".jpg", ".jpeg", ".eps", ".ps"];
    const resolve1 = (arg) => {
      const a = arg.toLowerCase().replace(/^\.\//, "");
      for (const e of exts) { const k = a + e; if (byRel.has(k)) return byRel.get(k); }
      for (const e of exts) { const k = path.basename(a) + e; if (byBase.has(k)) return byBase.get(k); }
      return null;
    };

    await fsp.mkdir(dir, { recursive: true });
    const manifest = [];
    let i = 0;
    for (const t of targets) {
      if (manifest.length >= 14) break;
      const src = resolve1(t);
      if (!src) continue;
      const ext = path.extname(src).toLowerCase();
      const name = String(i).padStart(2, "0") + ".png";
      const outNoExt = `${dir}/${String(i).padStart(2, "0")}`;
      let ok = false;
      if (ext === ".pdf") {
        ok = (await run("pdftoppm", ["-png", "-f", "1", "-l", "1", "-singlefile", "-scale-to", "1500", src, outNoExt])).code === 0;
      } else if (ext === ".eps" || ext === ".ps") {
        ok = (await run("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=pngalpha", "-r200", `-sOutputFile=${dir}/${name}`, src])).code === 0;
      } else if ([".png", ".jpg", ".jpeg", ".gif"].includes(ext)) {
        try { await fsp.copyFile(src, `${dir}/${name}`); ok = true; } catch {}
      }
      if (ok) { try { await fsp.access(`${dir}/${name}`); manifest.push(name); i++; } catch {} }
    }
    if (!manifest.length) throw new Error("no figures");
    await fsp.writeFile(`${dir}/manifest.json`, JSON.stringify(manifest));
    return manifest.map(f => `${base}/fig/arxiv/${encodeURIComponent(id)}/${f}`);
  } catch {
    return [];
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function serveFig(rest, res) {
  const [rawId, fileRaw] = rest.split("/");
  const id = decodeURIComponent(rawId || "");
  const fileName = (fileRaw || "").trim();
  if (!/^[0-9]{2}\.png$/.test(fileName)) { res.writeHead(400); return res.end("bad fig"); }
  const safe = id.replace(/[^a-z0-9.]/gi, "_");
  const file = `${FIG_CACHE}/${safe}/${fileName}`;
  try { await fsp.access(file); } catch { res.writeHead(404); return res.end("no fig"); }
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=604800",
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

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return " "; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return " "; } })
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&[a-z]+;/gi, " ");
}

// Figure captions from ar5iv, in document (figure) order.
async function extractCaptionsAr5iv(id) {
  try {
    const r = await fetch(`https://ar5iv.org/abs/${id}`, { headers: { "User-Agent": "pwfa-editor" }, redirect: "follow" });
    if (!r.ok) return [];
    const html = await r.text();
    return [...html.matchAll(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi)]
      .map(m => decodeEntities(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
      .filter(c => /^fig/i.test(c));   // figures only (drop tables etc.), keeps figure order
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
      let figUrls = await prepareFigures(id, origin);   // high-res from source
      if (!figUrls.length) figUrls = await extractFiguresAr5iv(id);  // fallback
      const caps = await extractCaptionsAr5iv(id);
      const figures = figUrls.map((url, i) => ({ url, caption: caps[i] || "" }));
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

// --- AI "key results": generated once on first view, cached, served to all. ---
// Not login-gated so it works for everyone; a single-flight guard caps load to
// one Claude run at a time so it can't stack up and starve the box.
const KEYRES_CACHE = `${PAPERS_DIR}/cache/keyresults`;
let keyResInFlight = false;

async function serveKeyResults(rawId, authHeader, cors, res) {
  const id = decodeURIComponent(rawId);
  const safe = id.replace(/[^a-z0-9.]/gi, "_");
  const file = `${KEYRES_CACHE}/${safe}.json`;
  const send = (obj, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", ...cors }); res.end(JSON.stringify(obj)); };
  try { return send(JSON.parse(await fsp.readFile(file, "utf8"))); } catch { /* not cached */ }

  if (keyResInFlight) return send({ keyResults: null, busy: true });

  keyResInFlight = true;
  try {
    const meta = await fetchArxiv(id).catch(() => ({}));
    const full = await fetchFullText(id).catch(() => null);
    const prompt = `You are summarizing a scientific paper for a research dashboard.
Title: ${meta.title || ""}
Abstract: ${meta.abstract || ""}
${full ? "Full text excerpt:\n" + String(full).slice(0, 12000) : ""}

List the 3 to 6 most important KEY RESULTS / findings of this paper as concise, specific bullet points (one sentence each, quantitative where the paper gives numbers). Exclude background and methodology. Respond with ONLY JSON: {"keyResults": ["...", "..."]}`;
    const text = await runClaude(prompt);
    let keyResults = [];
    try { const m = text.match(/\{[\s\S]*\}/); keyResults = JSON.parse(m ? m[0] : text).keyResults || []; } catch {}
    const out = { keyResults: Array.isArray(keyResults) ? keyResults : [] };
    try { await fsp.mkdir(KEYRES_CACHE, { recursive: true }); await fsp.writeFile(file, JSON.stringify(out)); } catch {}
    return send(out);
  } catch (e) {
    return send({ keyResults: null, error: e.message }, 502);
  } finally {
    keyResInFlight = false;
  }
}

// --- Local PDF store (publisher PDFs) — login-gated to the owner (copyright). ---
const LOCAL_DIR = `${PAPERS_DIR}/local`;
async function serveLocalPdf(rawKey, authHeader, reqOrigin, res) {
  const cors = {
    "Access-Control-Allow-Origin": reqOrigin || "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Vary": "Origin",
  };
  const key = decodeURIComponent(rawKey).replace(/\.pdf$/i, "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(key)) { res.writeHead(400, cors); return res.end("bad key"); }
  const token = (authHeader || "").replace(/^Bearer\s+/i, "");
  const v = await verifyAllowedUser(token, env);
  if (!v.ok) { res.writeHead(403, { ...cors, "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "login required" })); }
  const file = `${LOCAL_DIR}/${key}.pdf`;
  try { await fsp.access(file); } catch { res.writeHead(404, cors); return res.end("not found"); }
  res.writeHead(200, { ...cors, "Content-Type": "application/pdf", "Content-Disposition": "inline", "Cache-Control": "private, max-age=3600" });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  try {
    const origin = env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
    const url = origin.replace(/\/$/, "") + req.url;
    const pubCors = { "Access-Control-Allow-Origin": "*" };

    // Login-gated local publisher PDFs (CORS preflight + GET).
    if (req.url.startsWith("/pdf/local/")) {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Origin": req.headers.origin || "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, OPTIONS", "Vary": "Origin" });
        return res.end();
      }
      if (req.method === "GET") return serveLocalPdf(req.url.slice("/pdf/local/".length), req.headers.authorization, req.headers.origin, res);
    }

    // Public arXiv PDF proxy — handled directly (streams a file).
    if (req.method === "GET" && req.url.startsWith("/pdf/arxiv/")) {
      return serveArxivPdf(req.url.slice("/pdf/arxiv/".length), res);
    }
    // Public high-res figure images.
    if (req.method === "GET" && req.url.startsWith("/fig/arxiv/")) {
      return serveFig(req.url.slice("/fig/arxiv/".length), res);
    }
    // AI key results (owner generates, cached; public reads cache).
    if (req.method === "GET" && req.url.startsWith("/article/keyresults/arxiv/")) {
      return serveKeyResults(req.url.slice("/article/keyresults/arxiv/".length), req.headers.authorization, pubCors, res);
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
