// Local save helper for editing the graph from the local file:// copy.
//
// Run it while editing locally:   node editor/localsave.mjs
// The in-browser editor's Save then writes topics.js / papers.js to THIS folder
// and runs `git add/commit/push`, so the local copy updates first and the remote
// gets pushed. (A browser page can't write local files itself, hence this helper.)
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || 8788;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: REPO });
    let out = "", err = "";
    p.stdout.on("data", d => (out += d));
    p.stderr.on("data", d => (err += d));
    p.on("close", code => resolve({ code, out, err }));
    p.on("error", e => resolve({ code: -1, out, err: e.message }));
  });
}

http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  if (req.method === "POST" && req.url === "/save") {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", async () => {
      try {
        const { topics, papers, push } = JSON.parse(body || "{}");
        const written = [];
        if (typeof papers === "string") { await fs.writeFile(path.join(REPO, "papers.js"), papers); written.push("papers.js"); }
        if (typeof topics === "string") { await fs.writeFile(path.join(REPO, "topics.js"), topics); written.push("topics.js"); }
        if (!written.length) throw new Error("nothing to write");
        await run("git", ["add", ...written]);
        const c = await run("git", ["commit", "-m", "Editor (local): update " + written.join(" / ")]);
        const committed = c.code === 0 || /nothing to commit/.test(c.out + c.err);
        let pushed = false, pushErr = null;
        if (push !== false && committed) {
          const pr = await run("git", ["push"]);
          pushed = pr.code === 0;
          if (!pushed) pushErr = (pr.err || pr.out).trim().slice(0, 200);
        }
        res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, written, committed, pushed, pushErr }));
        console.log(`saved ${written.join(", ")} | committed=${committed} pushed=${pushed}${pushErr ? " (" + pushErr + ")" : ""}`);
      } catch (e) {
        res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }
  res.writeHead(404, CORS); res.end("not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Local save server → http://localhost:${PORT}  (repo: ${REPO})`));
