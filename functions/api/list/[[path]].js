// Cloudflare Pages Function. Proxies the Load Order Library API.
// Mirrors the /api/list/<slug-or-url> route from server.js so the same frontend
// works unchanged on Cloudflare Pages.

const API_BASE = "https://api.loadorderlibrary.com/v1";

// Accept a bare slug or a full loadorderlibrary.com URL; reduce it to the slug
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

export async function onRequestGet({ request }) {
  const { pathname } = new URL(request.url);
  const encoded = pathname.slice("/api/list/".length);
  let raw = encoded;
  try { raw = decodeURIComponent(encoded); } catch { /* fall back to raw */ }

  const slug = extractSlug(raw);
  if (!slug) return json({ error: "Invalid list slug or URL." }, 400);

  try {
    const upstream = await fetch(`${API_BASE}/lists/${encodeURIComponent(slug)}`, {
      headers: {
        "user-agent": "loadorder-compare/1.0", // A real UA avoids Cloudflare blocking the default worker fetch agent
        accept: "application/json",
      }
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
        // Let the Cloudflare edge cache repeat lookups, reducing load on loadorderlibrary.com
        "cache-control": "public, max-age=300",
      }
    });
  } catch (err) {
    return json({ error: `Could not reach the Load Order Library API: ${err.message}` }, 502);
  }
}
