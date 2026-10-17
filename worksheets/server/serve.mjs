// Class Manager local server.
//
// Gives the app (on devindi.in, or served here at http://localhost:4777)
// access to the Students folder, so the page never has to ask for a folder. Listens on
// 127.0.0.1 only. Writes are limited to the files the app owns:
// <Student>/prompt-log/*.md, templates.json and extra-hours.json.
//
//   node worksheets/server/serve.mjs
//   WB_STUDENTS="E:\Other\Students" WB_PORT=4800 node worksheets/server/serve.mjs

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STUDENTS = path.resolve(process.env.WB_STUDENTS || "D:\\Tushars\\Students");
const PORT = Number(process.env.WB_PORT || 4777);
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const MAX_WRITE = 2 * 1024 * 1024;
// The live site (devindi.in) runs the app and reads the folder through this server.
// Only these origins may read responses or send writes (writes need a preflight).
const ALLOWED_ORIGINS = new Set(["https://devindi.in", "https://www.devindi.in"]);

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT",
    "Access-Control-Allow-Headers": "X-Class-Manager, Content-Type",
    "Access-Control-Expose-Headers": "X-Mtime",
    // Chrome's private/local network access checks for public sites calling localhost.
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".pdf": "application/pdf",
  ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8"
};

// Resolve a "/"-separated path inside a base folder; null if it escapes.
function inside(base, rel) {
  const segs = String(rel || "").split("/").filter(Boolean);
  if (segs.some((s) => s === ".." || s === "." || /[\\:]/.test(s))) return null;
  const full = path.resolve(base, ...segs);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

function canWrite(rel) {
  const segs = String(rel).split("/").filter(Boolean);
  if (segs.length === 2 && (segs[1] === "templates.json" || segs[1] === "extra-hours.json")) return true;
  return segs.length === 3 && segs[1] === "prompt-log" && /\.md$/i.test(segs[2]);
}

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, headers || {}));
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), { "Content-Type": TYPES[".json"] });

async function api(req, res, url) {
  const rel = url.searchParams.get("path") || "";
  if (url.pathname === "/api/info") {
    let ok = true;
    try { await fs.access(STUDENTS); } catch { ok = false; }
    return json(res, 200, { root: STUDENTS, name: path.basename(STUDENTS), exists: ok, writable: true });
  }
  const full = inside(STUDENTS, rel);
  if (!full) return json(res, 400, { error: "bad path" });

  if (url.pathname === "/api/list" && req.method === "GET") {
    try {
      const ents = await fs.readdir(full, { withFileTypes: true });
      return json(res, 200, ents.map((e) => ({ name: e.name, kind: e.isDirectory() ? "directory" : "file" })));
    } catch { return json(res, 200, null); } // missing folder: an expected answer, not an error
  }
  if (url.pathname === "/api/file" && req.method === "GET") {
    try {
      const st = await fs.stat(full);
      if (!st.isFile()) return send(res, 204, "");
      const buf = await fs.readFile(full);
      return send(res, 200, buf, {
        "Content-Type": TYPES[path.extname(full).toLowerCase()] || "application/octet-stream",
        "X-Mtime": String(Math.round(st.mtimeMs))
      });
    } catch { return send(res, 204, ""); } // missing file (e.g. no templates.json yet)
  }
  if (url.pathname === "/api/file" && req.method === "PUT") {
    // The custom header forces a CORS preflight, which is only approved for
    // devindi.in, so other websites can't write here.
    if (req.headers["x-class-manager"] !== "1") return json(res, 403, { error: "missing header" });
    if (!canWrite(rel)) return json(res, 403, { error: "the app may only write prompt-log/*.md, templates.json and extra-hours.json" });
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_WRITE) return json(res, 413, { error: "too large" }); chunks.push(c); }
    try {
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, Buffer.concat(chunks));
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 500, { error: e.message }); }
  }
  return json(res, 404, { error: "unknown endpoint" });
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  if (rel.startsWith("/server/") || rel.startsWith("/docs/")) return send(res, 404, "Not found");
  const full = inside(APP, rel);
  if (!full) return send(res, 404, "Not found");
  try {
    const buf = await fs.readFile(full);
    send(res, 200, buf, { "Content-Type": TYPES[path.extname(full).toLowerCase()] || "application/octet-stream" });
  } catch { send(res, 404, "Not found"); }
}

const server = http.createServer(async (req, res) => {
  // Reject any Host other than localhost (blocks DNS-rebinding pages).
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 421, "Wrong host");
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cors = corsHeaders(req);
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
  try {
    if (req.method === "OPTIONS") {
      // Preflight: approved only for the allowed origins above.
      return send(res, cors["Access-Control-Allow-Origin"] ? 204 : 403, "");
    }
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else if (req.method === "GET") await serveStatic(req, res, url);
    else send(res, 405, "Method not allowed");
  } catch (e) {
    send(res, 500, "Server error: " + e.message);
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") { console.log(`Class Manager is already running on port ${PORT}.`); process.exit(0); }
  throw e;
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Class Manager: http://localhost:${PORT}  (Students folder: ${STUDENTS})`);
});
