# Load Order Compare

A small web app that does a set diff of two mod lists from [loadorderlibrary.com](https://loadorderlibrary.com).
Given two lists, it shows which plugins/mods are only in one of the two lists or shared by both.

Built for Bethesda-style load orders (Morrowind/Skyrim/Fallout, OpenMW, etc.), but should work with any list on the site (probably, not very well tested yet).

## Why a local server?

The Load Order Library API only allows browser (CORS) requests from `loadorderlibrary.com` itself. A tiny Node server serves the UI as static assets and proxies the API server-side. No API token is needed for public lists.

## Requirements

- Node.js 18+ (uses the built-in `fetch`; no npm dependencies)

## Run

```bash
node server.js
```

Then open http://localhost:5178. To use a different port:

```bash
PORT=8080 node server.js
```

## Usage

1. Enter a "slug" (`nerevar-moon-and-star`) or a full URL (`https://loadorderlibrary.com/lists/nerevar-moon-and-star`) for each list.
2. Click "Compare".
3. If a list has multiple files (e.g. `plugins.txt`, `modlist.txt`, `loadorder.txt`), pick which file to compare per side. When a list includes a `modlist.txt`, it is selected by default and grouping is turned on automatically, since that file has the category data.

## How entries are parsed

Each file's lines are normalized so the common formats compare:

| Format          | Example line          | Interpreted as        |
| --------------- | --------------------- | --------------------- |
| `loadorder.txt` | `Morrowind.esm`       | enabled plugin        |
| `plugins.txt`   | `*Dragonborn.esm`     | enabled plugin        |
| `modlist.txt`   | `+Some Mod`           | enabled mod           |
| `modlist.txt`   | `-Some Mod`           | disabled mod          |
| `modlist.txt`   | `+My Group_separator` | category heading (used for grouping) |

Lines starting with `#` (generator banners/comments) and blank lines are ignored. Matching is case-insensitive; the original name is displayed.

## Files

- `server.js` - static file server + `/api/list/<slug-or-url>` proxy.
- `public/index.html`, `public/styles.css`, `public/app.js` - the UI and diff logic. Vanilla JS.
