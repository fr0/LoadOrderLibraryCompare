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
};

// Holds the two loaded lists and which file index is selected for each side
const state = {
  a: { list: null, fileIndex: 0 },
  b: { list: null, fileIndex: 0 },
};

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
      entries.push({ name, enabled, isSeparator: true, category, key: name.toLowerCase() });
      continue;
    }

    entries.push({ name, enabled, isSeparator: false, category, key: name.toLowerCase() });
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

function renderDiff() {
  const entriesA = currentEntries("a");
  const entriesB = currentEntries("b");

  const mapA = new Map(entriesA.map((e) => [e.key, e]));
  const mapB = new Map(entriesB.map((e) => [e.key, e]));

  const aOnly = entriesA.filter((e) => !mapB.has(e.key));
  const bOnly = entriesB.filter((e) => !mapA.has(e.key));
  // "Shared" is based on A's entries so ordering/casing is stable.
  const shared = entriesA.filter((e) => mapB.has(e.key));

  const filter = els.filter.value.trim().toLowerCase();
  const match = (e) => !filter || e.key.includes(filter);

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
    ul.innerHTML = entries.map((e) => itemHtml(e, game)).join("");
    return;
  }
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.category)) groups.set(e.category, []);
    groups.get(e.category).push(e);
  }
  let html = "";
  for (const [cat, items] of groups) {
    // Sort mods within each category alphabetically by name (case-insensitive).
    items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
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
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    els.btn.disabled = false;
  }
});

els.filter.addEventListener("input", () => { if (state.a.list) renderDiff(); });
els.hideDisabled.addEventListener("change", () => { if (state.a.list) renderDiff(); });
els.group.addEventListener("change", () => { if (state.a.list) renderDiff(); });

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

// Prefill from ?a=&b= so comparisons are shareable/bookmarkable.
const params = new URLSearchParams(location.search);
if (params.get("a")) els.inputA.value = params.get("a");
if (params.get("b")) els.inputB.value = params.get("b");
if (params.get("a") && params.get("b")) els.form.requestSubmit();
