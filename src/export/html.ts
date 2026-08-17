import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ArchiveBundle } from "../core/archive.js";
import type { Entry } from "../core/types.js";
import { escapeHtml, formatBytes } from "../core/util.js";

/**
 * Writes a single self-contained page for browsing the archive.
 *
 * Everything is inlined and the data is embedded as JSON rather than fetched,
 * because `fetch` is blocked under the `file://` origin — this has to work by
 * double-clicking the file, with no server and no network.
 */

/** The shape sent to the browser: `raw` is dropped to keep the page small. */
interface WireEntry {
  i: string;
  p: string;
  k: string;
  t: number;
  x?: string;
  u?: string;
  f?: string;
  m?: { p: string; k: string }[];
}

function toWire(entry: Entry): WireEntry {
  const media = entry.media
    .map((item) => ({ p: item.archivePath ?? item.sourcePath, k: item.kind }))
    .filter((item) => Boolean(item.p));

  return {
    i: entry.id,
    p: entry.platform,
    k: entry.kind,
    t: entry.createdAt.getTime(),
    ...(entry.text ? { x: entry.text } : {}),
    ...(entry.url ? { u: entry.url } : {}),
    ...(entry.thread?.from ? { f: entry.thread.from } : {}),
    ...(media.length ? { m: media } : {}),
  };
}

const STYLE = `
:root {
  --bg: #fbfaf8; --panel: #ffffff; --ink: #1c1b19; --muted: #6b6862;
  --line: #e5e1da; --accent: #b4532a; --accent-soft: #f4e7e0;
  --radius: 12px;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #161513; --panel: #1f1e1b; --ink: #ece9e3; --muted: #9a958c;
    --line: #302e2a; --accent: #e0825a; --accent-soft: #33241d;
  }
}
:root[data-theme="dark"] {
  --bg: #161513; --panel: #1f1e1b; --ink: #ece9e3; --muted: #9a958c;
  --line: #302e2a; --accent: #e0825a; --accent-soft: #33241d;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 820px; margin: 0 auto; padding: 0 20px 80px; }
header { padding: 48px 0 24px; }
h1 { font-size: 1.9rem; margin: 0 0 6px; letter-spacing: -0.02em; }
.sub { color: var(--muted); margin: 0; }
.stats { display: flex; flex-wrap: wrap; gap: 20px; margin: 24px 0 0; padding: 0; list-style: none; }
.stats div { font-size: 1.35rem; font-weight: 600; }
.stats span { color: var(--muted); font-size: .82rem; text-transform: uppercase; letter-spacing: .06em; }
.controls {
  position: sticky; top: 0; z-index: 10; background: var(--bg);
  padding: 14px 0; border-bottom: 1px solid var(--line); margin-bottom: 8px;
}
input[type=search] {
  width: 100%; padding: 11px 14px; font: inherit; color: inherit;
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
}
input[type=search]:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.chip {
  font: inherit; font-size: .85rem; padding: 5px 12px; cursor: pointer;
  background: var(--panel); color: var(--muted);
  border: 1px solid var(--line); border-radius: 999px;
}
.chip[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.month {
  font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
  color: var(--muted); margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line);
}
.card {
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 16px 18px; margin-bottom: 12px; overflow-wrap: anywhere;
}
.meta { display: flex; gap: 10px; align-items: center; font-size: .78rem; color: var(--muted); margin-bottom: 8px; }
.tag {
  font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; font-weight: 600;
  padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent);
}
.card p { margin: 0; white-space: pre-wrap; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-top: 12px; }
.grid img, .grid video { width: 100%; height: 160px; object-fit: cover; border-radius: 8px; display: block; background: var(--bg); }
.grid a { text-decoration: none; }
.ext {
  display: flex; align-items: center; justify-content: center; height: 160px;
  border: 1px dashed var(--line); border-radius: 8px; color: var(--muted);
  font-size: .78rem; text-align: center; padding: 8px;
}
.more {
  display: block; width: 100%; margin-top: 24px; padding: 12px; cursor: pointer;
  font: inherit; background: var(--panel); color: var(--accent);
  border: 1px solid var(--line); border-radius: var(--radius);
}
.empty { text-align: center; color: var(--muted); padding: 60px 0; }
footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: .85rem; }
a { color: var(--accent); }
`;

const SCRIPT = `
const DATA = JSON.parse(document.getElementById("archive-data").textContent);
const PAGE = 60;
const state = { q: "", platform: null, kind: null, shown: PAGE };

const list = document.getElementById("list");
const search = document.getElementById("search");
const count = document.getElementById("count");

const fmtMonth = (t) =>
  new Date(t).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const fmtDate = (t) =>
  new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function matches(e) {
  if (state.platform && e.p !== state.platform) return false;
  if (state.kind && e.k !== state.kind) return false;
  if (!state.q) return true;
  const hay = ((e.x || "") + " " + (e.f || "")).toLowerCase();
  return state.q.split(/\\s+/).every((term) => hay.includes(term));
}

function mediaHtml(item) {
  const src = esc(item.p);
  if (/^https?:/i.test(item.p)) {
    return '<a class="ext" href="' + src + '" target="_blank" rel="noreferrer">' +
      'Stored on the platform &mdash; open link</a>';
  }
  if (item.k === "video") {
    return '<video controls preload="metadata" src="' + src + '"></video>';
  }
  if (item.k === "image") {
    return '<a href="' + src + '" target="_blank" rel="noreferrer">' +
      '<img loading="lazy" src="' + src + '" alt=""></a>';
  }
  return '<a class="ext" href="' + src + '">' + esc(item.p.split("/").pop()) + '</a>';
}

function cardHtml(e) {
  const bits = ['<article class="card">', '<div class="meta">',
    '<span class="tag">' + esc(e.p) + '</span>',
    '<span>' + esc(e.k) + '</span>',
    '<span>' + fmtDate(e.t) + '</span>'];
  if (e.f) bits.push('<span>from ' + esc(e.f) + '</span>');
  bits.push('</div>');
  if (e.x) bits.push('<p>' + esc(e.x) + '</p>');
  if (e.m && e.m.length) {
    bits.push('<div class="grid">' + e.m.map(mediaHtml).join("") + '</div>');
  }
  if (e.u) {
    bits.push('<div class="meta" style="margin:10px 0 0">' +
      '<a href="' + esc(e.u) + '" target="_blank" rel="noreferrer">original &rarr;</a></div>');
  }
  bits.push('</article>');
  return bits.join("");
}

function render() {
  const hits = DATA.entries.filter(matches);
  count.textContent = hits.length.toLocaleString() +
    (hits.length === 1 ? " entry" : " entries");

  if (!hits.length) {
    list.innerHTML = '<p class="empty">Nothing matches those filters.</p>';
    return;
  }

  const page = hits.slice(0, state.shown);
  let html = "";
  let month = "";
  for (const e of page) {
    const m = fmtMonth(e.t);
    if (m !== month) { month = m; html += '<h2 class="month">' + esc(m) + '</h2>'; }
    html += cardHtml(e);
  }
  if (hits.length > state.shown) {
    html += '<button class="more" id="more">Show more (' +
      (hits.length - state.shown).toLocaleString() + ' remaining)</button>';
  }
  list.innerHTML = html;

  const more = document.getElementById("more");
  if (more) more.onclick = () => { state.shown += PAGE; render(); };
}

let timer;
search.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    state.q = search.value.trim().toLowerCase();
    state.shown = PAGE;
    render();
  }, 120);
});

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => {
    const group = chip.dataset.group;
    const value = chip.dataset.value;
    const active = state[group] === value;
    state[group] = active ? null : value;
    for (const peer of document.querySelectorAll('.chip[data-group="' + group + '"]')) {
      peer.setAttribute("aria-pressed", String(peer === chip && !active));
    }
    state.shown = PAGE;
    render();
  });
}

render();
`;

export async function writeHtml(bundle: ArchiveBundle, outDir: string): Promise<string> {
  const { stats, profiles } = bundle;
  const wire = bundle.entries.map(toWire);

  const who = profiles
    .map((p) => (p.handle ? `@${p.handle}` : p.displayName))
    .filter(Boolean)
    .join(", ");

  const range =
    stats.earliest && stats.latest
      ? `${stats.earliest.getFullYear()}–${stats.latest.getFullYear()}`
      : "—";

  const chip = (group: string, value: string, label: string) =>
    `<button class="chip" data-group="${escapeHtml(group)}" data-value="${escapeHtml(value)}" aria-pressed="false">${escapeHtml(label)}</button>`;

  const platformChips = Object.entries(stats.byPlatform)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => chip("platform", id, `${id} (${n.toLocaleString()})`))
    .join("");

  const kindChips = Object.entries(stats.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => chip("kind", id, `${id} (${n.toLocaleString()})`))
    .join("");

  // </script> inside the data would close the tag early; the escape is
  // invisible to JSON.parse but keeps the parser from bailing out.
  const json = JSON.stringify({ entries: wire }).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(who || "My archive")} — Archivore</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>${escapeHtml(who || "My archive")}</h1>
  <p class="sub">Everything you posted, in one place. This page works offline and sends nothing anywhere.</p>
  <ul class="stats">
    <li><div>${stats.entries.toLocaleString()}</div><span>entries</span></li>
    <li><div>${stats.media.toLocaleString()}</div><span>media files</span></li>
    <li><div>${formatBytes(stats.mediaBytes)}</div><span>archived</span></li>
    <li><div>${range}</div><span>span</span></li>
  </ul>
</header>

<div class="controls">
  <input id="search" type="search" placeholder="Search your posts, captions and messages…" autocomplete="off">
  <div class="chips">${platformChips}</div>
  <div class="chips">${kindChips}</div>
</div>

<p class="sub" id="count"></p>
<main id="list"></main>

<footer>
  Built with <a href="https://github.com/deliseph/archivore">Archivore</a> —
  your data, on your disk, readable without anyone's permission.
</footer>
</div>

<script type="application/json" id="archive-data">${json}</script>
<script>${SCRIPT}</script>
</body>
</html>`;

  const path = join(outDir, "index.html");
  await writeFile(path, html, "utf8");
  return path;
}
