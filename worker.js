// Cloudflare Worker entry point (Workers + Static Assets)

const API_BASE = "https://api.loadorderlibrary.com/v1";

// Accept a bare slug or a full loadorderlibrary.com URL; reduce it to the slug.
function extractSlug(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/lists\/([^/?#]+)/i);
  const slug = (m ? m[1] : s).trim();
  return /^[A-Za-z0-9._-]+$/.test(slug) ? slug : null;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

async function proxyList(pathname) {
  const encoded = pathname.slice("/api/list/".length);
  let raw = encoded;
  try { raw = decodeURIComponent(encoded); } catch { /* fall back to raw */ }

  const slug = extractSlug(raw);
  if (!slug) return json({ error: "Invalid list slug or URL." }, 400);

  try {
    const upstream = await fetch(`${API_BASE}/lists/${encodeURIComponent(slug)}`, {
      headers: {
        "user-agent": "loadorder-compare/1.0", // A real UA avoids Cloudflare blocking the default worker fetch agent.
        accept: "application/json"
      },
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      const message =
        upstream.status === 404
          ? `No list found with slug "${slug}".`
          : `List not found or API error (HTTP ${upstream.status}).`;
      return json({ error: message }, upstream.status);
    }
    return new Response(text, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        // Let the Cloudflare edge cache repeat lookups, reducing load on the upstream API
        "cache-control": "public, max-age=300"
      }
    });
  } catch (err) {
    return json({ error: `Could not reach the Load Order Library API: ${err.message}` }, 502);
  }
}

async function proxyBrowse(pathname, searchParams) {
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
      headers: { "user-agent": "loadorder-compare/1.0", accept: "application/json" },
    });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=120"
      }
    });
  } catch (err) {
    return json({ error: `Could not reach the Load Order Library API: ${err.message}` }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/list/")) {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      return proxyList(url.pathname);
    }
    if (url.pathname === "/api/lists") return proxyBrowse("/lists", url.searchParams);
    if (url.pathname === "/api/games") return proxyBrowse("/games", url.searchParams);
    // Everything else is a static asset (index.html, app.js, styles.css, etc.)
    return env.ASSETS.fetch(request);
  },
};
