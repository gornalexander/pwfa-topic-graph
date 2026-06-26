// Node host for the editor backend on the VPS. Reuses worker.mjs's fetch()
// handler (Node 18+ provides global Request/Response/fetch). Run behind nginx
// + TLS as a systemd service. Config comes from environment variables
// (see /etc/pwfa-editor.env). Listens on 127.0.0.1:PORT.
import http from "node:http";
import worker from "./worker.mjs";

const PORT = process.env.PORT || 8787;
const env = {
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || "",
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  ALLOWED_USER: process.env.ALLOWED_USER || "gornalexander",
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "",
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN || "", // e.g. https://77-83-87-74.nip.io
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

http.createServer(async (req, res) => {
  try {
    // Reconstruct the public URL (behind nginx, use the configured origin).
    const origin = env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
    const url = origin.replace(/\/$/, "") + req.url;
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const body = hasBody ? await readBody(req) : undefined;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: body && body.length ? body : undefined,
    });
    const resp = await worker.fetch(request, env);
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
