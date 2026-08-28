// Load Order Compare front-end logic. Vanilla JavaScript.

// Don't need jQuery, but this is still convenient
const $ = (sel, root = document) => root.querySelector(sel);

const els = {
  form: $("#compare-form"),
  inputA: $("#input-a"),
  inputB: $("#input-b"),
  btn: $("#compare-btn"),
  status: $("#status"),
  meta: $("#meta"),
  controls: $("#controls"),
  results: $("#results"),
  filter: $("#filter"),
  hideDisabled: $("#opt-hide-disabled"),
  group: $("#opt-group"),
  groupLabel: $("#opt-group-label"),
  merge: $("#opt-merge"),
  sort: $("#opt-sort"),
  sortLabel: $("#opt-sort-label"),
};

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

// Holds the two loaded lists and which file index is selected for each side
const state = {
  a: { list: null, fileIndex: 0 },
  b: { list: null, fileIndex: 0 },
};

// Normalize a mod/plugin name to a comparison key.
// Case-insensitive. Treats spaces/underscores/hyphens as equivalent. Strips qualifiers that authors vary but that don't identify a different mod:
//   * engine tags: "(OpenMW)", "(OpenMW 0.49)", "for OpenMW", "Big Icons - OpenMW"
//   * parenthesized quality tags: "(HD)", "(2K)", "(4K)"
//   * trailing version numbers: "... 6.1", "... 25.08.12", "... v2.0"
// 2K vs. 4K could be argued to be genuinely different mods, so I'm kinda conflicted about this, but for now they're squished.
// (The trailing-version strip requires a dotted number at the end, so plugin extensions like ".esp"/".esm" are unaffected.)
function matchKey(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\((?:for\s+)?open\s*mw[^)]*\)/g, " ")
    .replace(/\((?:hd|sd|2k|4k|8k)\)/g, " ")
    .replace(/\b(?:for\s+)?open\s*mw\b/g, " ")
    .replace(/\s+(?:v(?:er(?:sion)?)?\.?\s*)?\d+(?:\.\d+)+\s*$/i, " ")
    .replace(/[-_\s]+/g, " ")
    .trim();
}

// Turn a file's raw content lines into structured entries
// Handles the common load-order formats:
//   loadorder.txt  -> plain plugin names
//   plugins.txt    -> "*name" enabled, "name" disabled
//   modlist.txt    -> "+name" enabled, "-name" disabled, "*_separator" groups
function parseContent(lines) {
  const entries = [];
  let category = "Uncategorized"; // nearest _separator heading seen above
  for (const rawLine of lines || []) {
    const line = String(rawLine).replace(/\r$/, "").trim();
    if (!line) continue;
    if (line.startsWith("#")) continue; // comment / generator banner

    let enabled = true;
    let name = line;

    const marker = line[0];
    if (marker === "+") { enabled = true; name = line.slice(1); }
    else if (marker === "-") { enabled = false; name = line.slice(1); }
    else if (marker === "*") { enabled = true; name = line.slice(1); }

    name = name.trim();
    if (!name) continue;

    if (/_separator$/i.test(name)) {
      category = name.replace(/_separator$/i, "").trim() || "Untitled section";
      entries.push({ name, enabled, isSeparator: true, category, key: matchKey(name) });
      continue;
    }

    entries.push({ name, enabled, isSeparator: false, category, key: matchKey(name) });
  }
  return entries;
}

// prefer modlist.txt
function preferredFileIndex(list) {
  const files = list?.files || [];
  const i = files.findIndex((f) => /^modlist\.txt$/i.test(f.clean_name || ""));
  return i >= 0 ? i : 0;
}

function sideHasCategories(side) {
  const { list, fileIndex } = state[side];
  const file = (list?.files || [])[fileIndex];
  return (file?.content || []).some((l) => /_separator\s*$/i.test(String(l)));
}

const KNOWN_FILES = new Set(["loadorder.txt", "modlist.txt", "plugins.txt"]);
function syncOtherSide(fromSide) {
  const other = fromSide === "a" ? "b" : "a";
  const fromFile = (state[fromSide].list?.files || [])[state[fromSide].fileIndex];
  const name = (fromFile?.clean_name || "").toLowerCase();
  if (!KNOWN_FILES.has(name)) return;

  const files = state[other].list?.files || [];
  const idx = files.findIndex((f) => (f.clean_name || "").toLowerCase() === name);
  if (idx < 0 || idx === state[other].fileIndex) return;

  state[other].fileIndex = idx;
  const sel = document.querySelector(`[data-file-select="${other}"]`);
  if (sel) sel.value = String(idx);
}

// Not really thrilled that we need this, but I don't see a more generic way to do it.
// (If you're reading this and you know of a better way, please submit a PR.)
// Things not listed here just fallback to the name.
const NEXUS_DOMAINS = {
  "tes3-morrowind": "morrowind",
  "tes4-oblivion": "oblivion",
  "tesiv-oblivion-remastered": "oblivionremastered",
  "tes5-skyrim-le": "skyrim",
  "tes5-skyrim-se": "skyrimspecialedition",
  "tes5-skyrim-vr": "skyrimspecialedition",
  "fallout-3": "fallout3",
  "fallout4": "fallout4",
  "fallout4-vr": "fallout4vr",
  "fallout-new-vegas": "newvegas",
  "starfield": "starfield",
  "enderal": "enderal",
  "enderal-se": "enderalspecialedition",
  "cyberpunk-2077": "cyberpunk2077",
  "baldurs-gate-3": "baldursgate3",
  "the-witcher-3-wild-hunt": "witcher3",
  "stardew-valley": "stardewvalley",
  "no-mans-sky": "nomanssky",
  "kerbal-space-program": "kerbalspaceprogram",
  "mount-blade-ii-bannerlord": "mountandblade2bannerlord",
};

// Transform a modlist mod name into a usable search query; drop Mod Organizer's "Unmanaged:" prefix for loose plugins and a trailing "(HD)"/"(OpenMW)" note.
function searchQuery(name) {
  return String(name)
    .replace(/^Unmanaged:\s*/i, "")
    .replace(/(?:\.(?:esp|esm|esl|omwaddon|omwscripts|omwgame|bsa|ba2))+$/i, "") // Drop extensions
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

// Compose a link that opens the mod on Nexus Mods. Can't deep-link the exact mod (no id in the data), so this opens a search.
// Links to nexusmods.com when the domain is known. Otherwise, a site:nexusmods.com web search as a fallback.
// Not really thrilled about this, but it's better than nothing.
function nexusUrl(name, gameSlug, gameName) {
  const q = searchQuery(name);
  const domain = NEXUS_DOMAINS[gameSlug];
  if (domain) {
    return `https://www.nexusmods.com/games/${domain}/mods?keyword=${encodeURIComponent(q)}`;
  }
  const g = gameName ? ` ${gameName}` : "";
  return `https://duckduckgo.com/?q=${encodeURIComponent(`site:nexusmods.com ${q}${g}`)}`;
}

async function fetchList(rawInput) {
  const res = await fetch(`/api/list/${encodeURIComponent(rawInput.trim())}`);
  const body = await res.json().catch(() => ({ error: "Bad response from server." }));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
  return body.data;
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
  els.status.hidden = !message;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function renderMeta(side) {
  const { list, fileIndex } = state[side];
  const card = $(`.meta-card[data-side="${side}"]`);
  if (!list) { card.innerHTML = ""; return; }

  const files = list.files || [];
  const options = files
    .map((f, i) => `<option value="${i}" ${i === fileIndex ? "selected" : ""}>${escapeHtml(f.clean_name || f.name)} (${(f.content || []).length} lines)</option>`)
    .join("");

  card.innerHTML = `
    <h3>${escapeHtml(list.name)} <span style="color:var(--muted);font-weight:400;">v${escapeHtml(list.version || "?")}</span></h3>
    <p class="sub">${escapeHtml(list.game?.name || "")} · by ${escapeHtml(list.author?.name || "unknown")}</p>
    <dl>
      <dt>Updated</dt><dd>${fmtDate(list.updated)}</dd>
      <dt>Files</dt><dd>${files.length}</dd>
    </dl>
    <div class="file-select">
      <label style="font-size:12px;color:var(--muted);">Compare file</label>
      <select data-file-select="${side}">${options}</select>
    </div>`;

  card.querySelector(`[data-file-select="${side}"]`).addEventListener("change", (e) => {
    state[side].fileIndex = Number(e.target.value);
    syncOtherSide(side);
    updateGroupAvailability();
    renderDiff();
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Compute the current mod entries for one side, respecting the option toggles.
// Separators are category headings, not mods, so they are not part of the diff.
function currentEntries(side) {
  const { list, fileIndex } = state[side];
  if (!list) return [];
  const file = (list.files || [])[fileIndex];
  let entries = parseContent(file?.content).filter((e) => !e.isSeparator);
  if (els.hideDisabled.checked) entries = entries.filter((e) => e.enabled);
  return entries;
}

// Enable "Group by category" only when a selected file actually has separators.
function updateGroupAvailability() {
  const available = sideHasCategories("a") || sideHasCategories("b");
  els.group.disabled = !available;
  els.groupLabel.style.opacity = available ? "1" : "0.45";
  if (!available) els.group.checked = false;
}

// Possible matches
const tokensOf = (name) => matchKey(name).split(" ").filter(Boolean);

// Flag likely same-mod pairs across the two "only" sets: word-token sets where one is a subset of the other (an added qualifier like "for OpenMW") or that overlap heavily.
function findPossibleMatches(aOnly, bOnly) {
  const aTok = aOnly.map((e) => new Set(tokensOf(e.name)));
  const bTok = bOnly.map((e) => new Set(tokensOf(e.name)));
  // Inverted index so we only compare entries that share at least one token.
  const byToken = new Map();
  bTok.forEach((set, j) => { for (const t of set) (byToken.get(t) || byToken.set(t, []).get(t)).push(j); });

  const pairs = [];
  aTok.forEach((sa, i) => {
    if (sa.size < 2) return; // single-word names are too ambiguous to guess
    const seen = new Set();
    for (const t of sa) {
      for (const j of byToken.get(t) || []) {
        if (seen.has(j)) continue;
        seen.add(j);
        const sb = bTok[j];
        if (sb.size < 2) continue;
        let inter = 0;
        for (const x of sa) if (sb.has(x)) inter++;
        if (inter < 2) continue;
        const subset = inter === Math.min(sa.size, sb.size);
        const sim = inter / (sa.size + sb.size - inter);
        if (subset || sim >= 0.6) pairs.push({ a: aOnly[i], b: bOnly[j], score: (subset ? 1 : 0) + sim });
      }
    }
  });
  return pairs.sort((p, q) => q.score - p.score).slice(0, 200);
}

// Recompute only when the underlying sets change (not on filter/display toggles)
let possibleMemo = { sig: null, pairs: [] };
function possibleMatchesFor(aOnly, bOnly) {
  const sig = `${state.a.list?.slug}|${state.a.fileIndex}|${state.b.list?.slug}|${state.b.fileIndex}|${els.hideDisabled.checked}`;
  if (sig !== possibleMemo.sig) possibleMemo = { sig, pairs: findPossibleMatches(aOnly, bOnly) };
  return possibleMemo.pairs;
}

function renderPossible(pairs, merged) {
  const box = document.getElementById("possible");
  if (!pairs.length) { box.hidden = true; return; }
  box.hidden = false;
  document.getElementById("possible-count").textContent = pairs.length;
  const hint = box.querySelector(".pm-hint");
  if (hint) hint.textContent = merged ? "counted as Shared" : "likely the same mod, named differently (not merged)";
  const side = (e, cls) => `<span class="pm-${cls}"><span class="dot ${cls}"></span>` +
    `<span class="pm-name">${escapeHtml(e.name)}</span>` +
    (e.category ? ` <span class="pm-cat">${escapeHtml(e.category)}</span>` : "") + `</span>`;
  document.getElementById("possible-list").innerHTML = pairs.map((p) =>
    `<div class="pm-row">${side(p.a, "a")}<span class="pm-arrow">-</span>${side(p.b, "b")}</div>`).join("");
}

function renderDiff() {
  const entriesA = currentEntries("a");
  const entriesB = currentEntries("b");

  const mapA = new Map(entriesA.map((e) => [e.key, e]));
  const mapB = new Map(entriesB.map((e) => [e.key, e]));

  let aOnly = entriesA.filter((e) => !mapB.has(e.key));
  let bOnly = entriesB.filter((e) => !mapA.has(e.key));
  // "Shared" is based on A's entries so ordering/casing is stable.
  let shared = entriesA.filter((e) => mapB.has(e.key));

  // Fuzzy "possible matches" come from the exact-only sets; optionally promote
  // them into Shared. Computed before the display filter, so the merge is total.
  const pairs = possibleMatchesFor(aOnly, bOnly);
  const merged = els.merge.checked && pairs.length > 0;
  if (merged) {
    // Match by key (stable string) — pairs may reference entry objects from a
    // memoized earlier render, so object identity won't line up.
    const matchedA = new Set(pairs.map((p) => p.a.key));
    const matchedB = new Set(pairs.map((p) => p.b.key));
    shared = shared.concat(aOnly.filter((e) => matchedA.has(e.key)));
    aOnly = aOnly.filter((e) => !matchedA.has(e.key));
    bOnly = bOnly.filter((e) => !matchedB.has(e.key));
  }

  const filter = matchKey(els.filter.value);
  const match = (e) => !filter || e.key.includes(filter);

  // Sorting only applies to the ungrouped view (grouping sorts by name within
  // each category), so disable the control while grouping is active.
  els.sort.disabled = els.group.checked;
  els.sortLabel.style.opacity = els.group.checked ? "0.45" : "1";

  const gameA = state.a.list?.game || {};
  const gameB = state.b.list?.game || {};
  fillColumn("a-only", aOnly.filter(match), gameA);
  fillColumn("shared", shared.filter(match), gameA);
  fillColumn("b-only", bOnly.filter(match), gameB);

  const nameA = state.a.list?.name || "A";
  const nameB = state.b.list?.name || "B";
  $(`.col[data-kind="a-only"] [data-label]`).textContent = `Only in ${nameA}`;
  $(`.col[data-kind="b-only"] [data-label]`).textContent = `Only in ${nameB}`;

  $(`.col[data-kind="a-only"] [data-count]`).textContent = aOnly.length;
  $(`.col[data-kind="shared"] [data-count]`).textContent = shared.length;
  $(`.col[data-kind="b-only"] [data-count]`).textContent = bOnly.length;

  // The results filter also narrows the possible-matches panel (either side)
  const shownPairs = filter ? pairs.filter((p) => p.a.key.includes(filter) || p.b.key.includes(filter)) : pairs;
  renderPossible(shownPairs, merged);

  els.controls.hidden = false;
  els.results.hidden = false;
}

function itemHtml(e, game) {
  const name = escapeHtml(e.name);
  const href = escapeHtml(nexusUrl(e.name, game.slug, game.name));
  const off = e.enabled ? "" : '<span class="tag">off</span>';
  return `<li class="${e.enabled ? "" : "disabled"}" data-name="${name}">` +
    `<span class="mod" title="${name}">${name}${off}</span>` +
    `<a class="ext" href="${href}" target="_blank" rel="noopener noreferrer" title="Find “${searchQuery(e.name).replace(/"/g, "&quot;")}” on Nexus Mods" aria-label="Open Nexus Mods for ${name}">↗</a>` +
    `</li>`;
}

function fillColumn(kind, entries, game) {
  const ul = $(`.col[data-kind="${kind}"] ul`);
  if (!entries.length) {
    ul.innerHTML = `<li class="empty">Nothing here.</li>`;
    return;
  }
  if (!els.group.checked) {
    // Ungrouped: file order by default, or alphabetical when "Name" is chosen.
    const rows = els.sort.value === "name" ? [...entries].sort(byName) : entries;
    ul.innerHTML = rows.map((e) => itemHtml(e, game)).join("");
    return;
  }
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.category)) groups.set(e.category, []);
    groups.get(e.category).push(e);
  }
  let html = "";
  for (const [cat, items] of groups) {
    items.sort(byName);
    html += `<li class="cat-head">${escapeHtml(cat)}<span class="cat-count">${items.length}</span></li>`;
    html += items.map((e) => itemHtml(e, game)).join("");
  }
  ul.innerHTML = html;
}

// Copy a column's entries (names only) to the clipboard.
function wireCopyButtons() {
  for (const btn of document.querySelectorAll("[data-copy]")) {
    btn.addEventListener("click", async () => {
      const ul = btn.parentElement.querySelector("ul");
      const names = [...ul.querySelectorAll("li[data-name]")].map((li) => li.getAttribute("data-name"));
      if (!names.length) return;
      try {
        await navigator.clipboard.writeText(names.join("\n"));
        const original = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = original), 1200);
      } catch {
        setStatus("Clipboard blocked by the browser.", true);
      }
    });
  }
}

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const a = els.inputA.value.trim();
  const b = els.inputB.value.trim();
  if (!a || !b) { setStatus("Enter a slug or URL for both lists.", true); return; }

  els.btn.disabled = true;
  setStatus("Loading lists…");
  els.meta.hidden = true;
  els.results.hidden = true;
  els.controls.hidden = true;

  try {
    const [listA, listB] = await Promise.all([fetchList(a), fetchList(b)]);
    state.a = { list: listA, fileIndex: preferredFileIndex(listA) };
    state.b = { list: listB, fileIndex: preferredFileIndex(listB) };
    setStatus("");
    els.meta.hidden = false;
    renderMeta("a");
    renderMeta("b");
    updateGroupAvailability();
    if (!els.group.disabled) els.group.checked = true;
    renderDiff();
    els.inputA.value = listA.slug;
    els.inputB.value = listB.slug;
    // Reflect the comparison in the address bar so it's shareable/bookmarkable.
    const params = new URLSearchParams({ a: listA.slug, b: listB.slug });
    history.replaceState(null, "", `?${params}`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    els.btn.disabled = false;
  }
});

els.filter.addEventListener("input", () => { if (state.a.list) renderDiff(); });
els.hideDisabled.addEventListener("change", () => { if (state.a.list) renderDiff(); });
els.group.addEventListener("change", () => { if (state.a.list) renderDiff(); });
els.merge.addEventListener("change", () => { if (state.a.list) renderDiff(); });
els.sort.addEventListener("change", () => { if (state.a.list) renderDiff(); });

wireCopyButtons();

// The initial theme is set by an inline <head> script (to avoid a flash on load); here  we just keep the button icon in sync and persist the user's choice
const THEME_KEY = "locompare-theme";
const themeBtn = document.getElementById("theme-toggle");
function syncThemeIcon() {
  const dark = document.documentElement.dataset.theme === "dark";
  if (themeBtn) themeBtn.textContent = dark ? "☀️" : "🌙";
}
themeBtn?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  syncThemeIcon();
});
syncThemeIcon();

// Monospace toggle for the mod-list font (initial value set by the head script)
const MONO_KEY = "locompare-mono";
const monoBox = document.getElementById("opt-mono");
if (monoBox) {
  monoBox.checked = document.documentElement.dataset.mono === "true";
  monoBox.addEventListener("change", () => {
    document.documentElement.dataset.mono = monoBox.checked ? "true" : "false";
    try { localStorage.setItem(MONO_KEY, String(monoBox.checked)); } catch {}
  });
}

// Modal dialog for browsing lists
const browse = {
  el: document.getElementById("browse"),
  target: document.getElementById("browse-target"),
  search: document.getElementById("browse-search"),
  game: document.getElementById("browse-game"),
  results: document.getElementById("browse-results"),
  prev: document.getElementById("browse-prev"),
  next: document.getElementById("browse-next"),
  pageinfo: document.getElementById("browse-pageinfo"),
  closeBtn: document.getElementById("browse-close"),
};
const browseState = { side: "a", page: 1, lastPage: 1, gamesLoaded: false, reqId: 0 };
// Remembers the game of the list picked/loaded per side, to default the filter.
const browseGameHint = { a: null, b: null };
const sideGame = (s) => browseGameHint[s] || state[s].list?.game?.slug || null;

async function openBrowse(side) {
  browseState.side = side;
  browse.target.textContent = `List ${side.toUpperCase()}`;
  browse.el.hidden = false;
  browse.search.value = "";
  await loadGames();
  // Default the game filter to a known game: prefer the other side's loaded
  // list, else this side's. (Either is set once a comparison has run.)
  const other = side === "a" ? "b" : "a";
  const knownGame = sideGame(other) || sideGame(side);
  browse.game.value = knownGame && [...browse.game.options].some((o) => o.value === knownGame) ? knownGame : "";
  browseState.page = 1;
  runBrowse();
  browse.search.focus();
}
function closeBrowse() { browse.el.hidden = true; }

// Populate the game filter once, from /api/games
async function loadGames() {
  if (browseState.gamesLoaded) return;
  try {
    const res = await fetch("/api/games");
    const body = await res.json();
    const games = (body.data || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const g of games) {
      const opt = document.createElement("option");
      opt.value = g.slug;
      opt.textContent = g.lists_count != null ? `${g.name} (${g.lists_count})` : g.name;
      browse.game.appendChild(opt);
    }
    browseState.gamesLoaded = true;
  } catch { /* leave just "All games" */ }
}

async function runBrowse() {
  const reqId = ++browseState.reqId; // ignore responses to superseded requests
  browse.results.innerHTML = `<p class="browse-msg">Loading…</p>`;
  const qs = new URLSearchParams();
  if (browse.search.value.trim()) qs.set("query", browse.search.value.trim());
  if (browse.game.value) qs.set("game", browse.game.value);
  qs.set("page", String(browseState.page));
  try {
    const res = await fetch(`/api/lists?${qs}`);
    const body = await res.json();
    if (reqId !== browseState.reqId) return;
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
    renderBrowse(body);
  } catch (err) {
    if (reqId !== browseState.reqId) return;
    browse.results.innerHTML = `<p class="browse-msg error">${escapeHtml(err.message)}</p>`;
  }
}

// A single selectable list row
function browseRowHtml(it) {
  const sub = [it.game?.name, it.version ? `v${it.version}` : null, it.author?.name ? `by ${it.author.name}` : null, fmtDate(it.updated)]
    .filter(Boolean).map(escapeHtml).join(" · ");
  return `<button class="browse-row" type="button" data-slug="${escapeHtml(it.slug)}" data-game="${escapeHtml(it.game?.slug || "")}">` +
    `<span class="browse-name">${escapeHtml(it.name)}</span>` +
    `<span class="browse-meta">${sub}</span></button>`;
}

// One version inside an expanded group (name/author are shown on the head)
function versionRowHtml(it) {
  const when = [fmtDate(it.updated), it.version ? `v${it.version}` : null].filter(Boolean).map(escapeHtml).join(" · ");
  return `<button class="browse-row version-row" type="button" data-slug="${escapeHtml(it.slug)}" data-game="${escapeHtml(it.game?.slug || "")}">` +
    `<span class="v-when">${when}</span><span class="v-slug">${escapeHtml(it.slug)}</span></button>`;
}

// Collapsed head for a group of same-name + same-author versions.
function groupHeadHtml(items) {
  const newest = items[0];
  const sub = [newest.game?.name, newest.author?.name ? `by ${newest.author.name}` : null, `latest ${fmtDate(newest.updated)}`]
    .filter(Boolean).map(escapeHtml).join(" · ");
  return `<button class="browse-row browse-group-head" type="button" aria-expanded="false">` +
    `<span class="browse-name">${escapeHtml(newest.name)} <span class="ver-badge">${items.length} versions</span></span>` +
    `<span class="browse-meta">${sub}</span></button>`;
}

function groupVersions(items) {
  const groups = [];
  const index = new Map();
  for (const it of items) {
    const author = it.author?.name || "";
    // Anonymous lists aren't grouped — same name by different people isn't a version.
    const key = author ? `${it.name.trim().toLowerCase()}|${author.toLowerCase()}` : null;
    if (key && index.has(key)) {
      groups[index.get(key)].push(it);
    } else {
      if (key) index.set(key, groups.length);
      groups.push([it]);
    }
  }
  return groups;
}

function renderBrowse(body) {
  const items = body.data || [];
  const meta = body.meta || {};
  browseState.page = meta.current_page || 1;
  browseState.lastPage = meta.last_page || 1;
  if (!items.length) {
    browse.results.innerHTML = `<p class="browse-msg">No lists found.</p>`;
  } else {
    browse.results.innerHTML = groupVersions(items).map((group) => {
      if (group.length === 1) return browseRowHtml(group[0]);
      group.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
      return `<div class="browse-group">${groupHeadHtml(group)}` +
        `<div class="browse-versions" hidden>${group.map(versionRowHtml).join("")}</div></div>`;
    }).join("");
  }
  const total = meta.total != null ? ` · ${meta.total} lists` : "";
  browse.pageinfo.textContent = `Page ${browseState.page} of ${browseState.lastPage}${total}`;
  browse.prev.disabled = browseState.page <= 1;
  browse.next.disabled = browseState.page >= browseState.lastPage;
  browse.results.scrollTop = 0;
}

function pickBrowse(slug) {
  (browseState.side === "a" ? els.inputA : els.inputB).value = slug;
  closeBrowse();
  // If both sides are now filled, jump straight to the comparison
  if (els.inputA.value.trim() && els.inputB.value.trim()) els.form.requestSubmit();
  else (browseState.side === "a" ? els.inputB : els.inputA).focus();
}

for (const btn of document.querySelectorAll("[data-browse]")) {
  btn.addEventListener("click", () => openBrowse(btn.dataset.browse));
}
browse.closeBtn.addEventListener("click", closeBrowse);
browse.el.addEventListener("click", (e) => { if (e.target === browse.el) closeBrowse(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !browse.el.hidden) closeBrowse(); });
browse.results.addEventListener("click", (e) => {
  const head = e.target.closest(".browse-group-head");
  if (head) {
    const versions = head.nextElementSibling; // .browse-versions
    const opening = versions.hidden;
    versions.hidden = !opening;
    head.setAttribute("aria-expanded", String(opening));
    return;
  }
  const row = e.target.closest("[data-slug]");
  if (row) {
    if (row.dataset.game) browseGameHint[browseState.side] = row.dataset.game;
    pickBrowse(row.dataset.slug);
  }
});
let browseDebounce;
browse.search.addEventListener("input", () => {
  clearTimeout(browseDebounce);
  browseDebounce = setTimeout(() => { browseState.page = 1; runBrowse(); }, 300);
});
browse.game.addEventListener("change", () => { browseState.page = 1; runBrowse(); });
browse.prev.addEventListener("click", () => { if (browseState.page > 1) { browseState.page--; runBrowse(); } });
browse.next.addEventListener("click", () => { if (browseState.page < browseState.lastPage) { browseState.page++; runBrowse(); } });

// Prefill from ?a=&b= so comparisons are shareable/bookmarkable.
const params = new URLSearchParams(location.search);
if (params.get("a")) els.inputA.value = params.get("a");
if (params.get("b")) els.inputB.value = params.get("b");
if (params.get("a") && params.get("b")) els.form.requestSubmit();
