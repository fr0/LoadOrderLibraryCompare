// Zero-dependency local server for comparing loadorderlibrary.com lists.
// Serves the static UI from ./public and proxies the Load Order Library API
// (needed because the API's CORS policy blocks direct browser calls).

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const API_BASE = "https://api.loadorderlibrary.com/v1";
const PORT = process.env.PORT || 5178;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

// A slug is what appears after /lists/ in a URL. Accept a bare slug or a full
// loadorderlibrary.com URL and reduce it to the slug.
function extractSlug(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/lists\/([^/?#]+)/i);
  const slug = (m ? m[1] : s).trim();
  // Allow only the characters slugs actually use, to keep the proxy tight.
  return /^[A-Za-z0-9._-]+$/.test(slug) ? slug : null;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function proxyList(res, slug) {
  try {
    const upstream = await fetch(`${API_BASE}/lists/${encodeURIComponent(slug)}`, {
      headers: {
        // A real UA avoids Cloudflare blocking the default Node fetch agent.
        "user-agent": "loadorder-compare/1.0 (local tool)",
        accept: "application/json",
      },
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      let message = `List not found or API error (HTTP ${upstream.status}).`;
      if (upstream.status === 404) message = `No list found with slug "${slug}".`;
      return sendJson(res, upstream.status, { error: message });
    }
    // Pass the upstream JSON straight through.
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(text);
  } catch (err) {
    sendJson(res, 502, { error: `Could not reach the Load Order Library API: ${err.message}` });
  }
}

// Proxy the browse/index endpoints (/lists, /games). For /lists whitelist a few params and map them to the upstream's names (query, filter[game], page).
async function proxyBrowse(res, pathname, searchParams) {
  const upstream = new URL(`${API_BASE}${pathname}`);
  if (pathname === "/lists") {
    const page = searchParams.get("page");
    const query = searchParams.get("query");
    const game = searchParams.get("game");
    if (page) upstream.searchParams.set("page", page);
    if (query) upstream.searchParams.set("query", query);
    if (game) upstream.searchParams.set("filter[game]", game);
  }
  try {
    const r = await fetch(upstream, {
      headers: { "user-agent": "loadorder-compare/1.0 (local tool)", accept: "application/json" },
    });
    const text = await r.text();
    res.writeHead(r.status, { "content-type": "application/json; charset=utf-8" });
    res.end(text);
  } catch (err) {
    sendJson(res, 502, { error: `Could not reach the Load Order Library API: ${err.message}` });
  }
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  // Prevent path traversal outside PUBLIC_DIR.
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Browse proxies: /api/lists (searchable index) and /api/games (filter options)
  if (url.pathname === "/api/lists") return proxyBrowse(res, "/lists", url.searchParams);
  if (url.pathname === "/api/games") return proxyBrowse(res, "/games", url.searchParams);

  // API proxy: /api/list/<slug-or-url>
  if (url.pathname.startsWith("/api/list/")) {
    const raw = decodeURIComponent(url.pathname.slice("/api/list/".length));
    const slug = extractSlug(raw);
    if (!slug) return sendJson(res, 400, { error: "Invalid list slug or URL." });
    return proxyList(res, slug);
  }

  return serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`\n  Load Order compare running at  http://localhost:${PORT}\n`);
});
