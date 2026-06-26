// Node host for the editor backend on the VPS.
// - /auth/* (OAuth) is handled by worker.mjs's fetch().
// - /ai/draft is handled here: reads the paper, then drafts via the Claude CLI
//   (Claude Code, authenticated by the subscription token CLAUDE_CODE_OAUTH_TOKEN)
//   instead of the paid Anthropic API.
import http from "node:http";
import { spawn } from "node:child_process";
import worker, {
  corsHeaders, json, verifyAllowedUser,
  parseLink, fetchArxiv, fetchCrossref, fetchFullText, buildDraftPrompt,
} from "./worker.mjs";

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
function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", prompt, "--output-format", "text"], {
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN,
        HOME: process.env.HOME || "/opt/pwfa-editor/home",
      },
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err || `claude exited ${code}`)));
  });
}

async function handleDraftCLI(request, cors) {
  const auth = request.headers.get("Authorization") || "";
  const ghToken = auth.replace(/^Bearer\s+/i, "");
  const v = await verifyAllowedUser(ghToken, env);
  if (!v.ok) return json({ error: v.error }, v.status, cors);

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

http.createServer(async (req, res) => {
  try {
    const origin = env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
    const url = origin.replace(/\/$/, "") + req.url;
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
