import { writeFile } from "node:fs/promises";

import type { RankedFinding, SessionReport } from "../core/types.js";

/**
 * The review as a single HTML file.
 *
 * Nothing is hosted and nothing is fetched: the data is embedded, the styles
 * are inlined, and the file opens by double-clicking it on a laptop or tapping
 * it on a phone. A review is worth reading away from the terminal that
 * produced it.
 *
 * It is also built to print. A saved PDF is a record of what was flagged and
 * by whom, which outlives both the branch and this tool.
 */

/** Escapes text for safe interpolation into HTML. */
function esc(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
:root {
  --bg:#fbfaf8; --panel:#fff; --ink:#1c1b19; --muted:#6b6862; --line:#e5e1da;
  --ok:#1f7a4d; --warn:#b4532a; --off:#8a857d;
  --crit:#c0392b; --major:#b4532a; --minor:#3a6ea5; --nit:#8a857d;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:#161513; --panel:#1f1e1b; --ink:#ece9e3; --muted:#9a958c; --line:#302e2a;
    --ok:#4ade80; --warn:#e0825a; --off:#78716c;
    --crit:#f87171; --major:#e0825a; --minor:#7aa9dd; --nit:#78716c;
  }
}
:root[data-theme="dark"]{
  --bg:#161513; --panel:#1f1e1b; --ink:#ece9e3; --muted:#9a958c; --line:#302e2a;
  --ok:#4ade80; --warn:#e0825a; --off:#78716c;
  --crit:#f87171; --major:#e0825a; --minor:#7aa9dd; --nit:#78716c;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:820px;margin:0 auto;padding:0 18px 72px}
header{padding:36px 0 18px}
h1{font-size:1.6rem;margin:0 0 4px;letter-spacing:-.02em}
.sub{color:var(--muted);margin:0;font-size:.95rem}
.stats{display:flex;flex-wrap:wrap;gap:22px;margin:22px 0 0;padding:0;list-style:none}
.stats div{font-size:1.3rem;font-weight:600}
.stats span{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em}
.controls{position:sticky;top:0;z-index:5;background:var(--bg);padding:12px 0;
  border-bottom:1px solid var(--line);margin-bottom:6px}
.chips{display:flex;flex-wrap:wrap;gap:7px}
.chip{font:inherit;font-size:.82rem;padding:5px 12px;cursor:pointer;background:var(--panel);
  color:var(--muted);border:1px solid var(--line);border-radius:999px}
.chip[aria-pressed="true"]{border-color:currentColor}
.chip.confirmed[aria-pressed="true"]{color:var(--ok)}
.chip.single[aria-pressed="true"]{color:var(--warn)}
.chip.disputed[aria-pressed="true"]{color:var(--off)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:11px;
  padding:15px 17px;margin-bottom:11px;overflow-wrap:anywhere}
.verdict{font-size:.7rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase}
.verdict.confirmed{color:var(--ok)}
.verdict.single{color:var(--warn)}
.verdict.disputed{color:var(--off)}
.who{color:var(--muted);font-size:.75rem;font-weight:400;letter-spacing:0;text-transform:none}
h2.t{font-size:1.02rem;margin:7px 0 5px;line-height:1.35}
.loc{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.83rem;color:var(--minor)}
.sev{font-size:.68rem;font-weight:700;letter-spacing:.06em;padding:2px 7px;border-radius:4px;
  border:1px solid currentColor;margin-right:7px}
.sev.critical{color:var(--crit)}.sev.major{color:var(--major)}
.sev.minor{color:var(--minor)}.sev.nit{color:var(--nit)}
.detail{color:var(--muted);font-size:.92rem;margin:9px 0 0}
.roster{margin-top:34px;border-top:1px solid var(--line);padding-top:18px}
.roster h3{font-size:.78rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:0 0 10px}
.rev{display:flex;gap:9px;align-items:baseline;font-size:.88rem;padding:3px 0}
.rev .v{color:var(--muted);font-size:.78rem}
.empty{text-align:center;color:var(--muted);padding:48px 0}
.note{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--warn);
  border-radius:7px;padding:11px 14px;margin:14px 0;font-size:.9rem;color:var(--muted)}
footer{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);
  color:var(--muted);font-size:.82rem}
.actions{display:flex;gap:8px;margin-top:14px}
button.act{font:inherit;font-size:.85rem;padding:7px 15px;cursor:pointer;background:var(--panel);
  color:var(--ink);border:1px solid var(--line);border-radius:8px}

/* Printing is the point: a saved PDF is the record. Every finding is already
   in the document — a review is tens of items, not thousands — so nothing is
   hidden behind pagination and a print can never be silently incomplete. */
@media print {
  :root{--bg:#fff;--panel:#fff;--ink:#000;--muted:#444;--line:#bbb;
        --ok:#1f7a4d;--warn:#a04422;--off:#666;
        --crit:#a3271b;--major:#a04422;--minor:#25507a;--nit:#666}
  body{background:#fff;color:#000;font-size:11pt}
  .wrap{max-width:none;padding:0}
  .controls,.actions{display:none !important}
  .card{break-inside:avoid;page-break-inside:avoid;border:1px solid #ccc;margin-bottom:8px}
  .roster{break-inside:avoid}
  header{padding-top:0}
  a{color:#000;text-decoration:none}
  @page{margin:16mm}
}
`;

const SCRIPT = `
const DATA = JSON.parse(document.getElementById("report-data").textContent);
const state = { verdict: null, severity: null };
const list = document.getElementById("list");
const count = document.getElementById("count");

const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

function matches(f) {
  if (state.verdict && f.verdict !== state.verdict) return false;
  if (state.severity && f.severity !== state.severity) return false;
  return true;
}

function card(f) {
  const who = f.verdict === "confirmed"
    ? f.agreement + " vendors agreed \\u2014 " + esc(f.raisedBy.join(", "))
    : f.verdict === "disputed"
      ? esc((f.disputedBy || []).join(", ")) + " reviewed this file and saw nothing here"
      : "only " + esc(f.raisedBy.join(", "));

  return '<article class="card">'
    + '<div class="verdict ' + f.verdict + '">' + f.verdict
    + ' <span class="who">' + who + '</span></div>'
    + '<h2 class="t"><span class="sev ' + f.severity + '">' + f.severity.toUpperCase()
    + '</span>' + esc(f.title) + '</h2>'
    + '<div class="loc">' + esc(f.file) + (f.line ? ":" + f.line : "") + '</div>'
    + (f.detail ? '<p class="detail">' + esc(f.detail) + '</p>' : '')
    + '</article>';
}

function render() {
  const hits = DATA.findings.filter(matches);
  count.textContent = hits.length + (hits.length === 1 ? " finding" : " findings");
  list.innerHTML = hits.length
    ? hits.map(card).join("")
    : '<p class="empty">Nothing matches those filters.</p>';
}

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => {
    const g = chip.dataset.group, v = chip.dataset.value;
    const active = state[g] === v;
    state[g] = active ? null : v;
    for (const peer of document.querySelectorAll('.chip[data-group="' + g + '"]'))
      peer.setAttribute("aria-pressed", String(peer === chip && !active));
    render();
  });
}

// A printed record must show everything, never whatever filter happened to be
// active when the button was pressed.
const printBtn = document.getElementById("print");
if (printBtn) printBtn.onclick = () => {
  const saved = { verdict: state.verdict, severity: state.severity };
  state.verdict = null; state.severity = null;
  for (const peer of document.querySelectorAll(".chip")) peer.setAttribute("aria-pressed", "false");
  render();
  window.print();
  state.verdict = saved.verdict; state.severity = saved.severity;
  for (const peer of document.querySelectorAll(".chip"))
    peer.setAttribute("aria-pressed", String(state[peer.dataset.group] === peer.dataset.value));
  render();
};

render();
`;

function chip(group: string, value: string, label: string, cls = ""): string {
  return `<button class="chip ${cls}" data-group="${esc(group)}" data-value="${esc(value)}" aria-pressed="false">${esc(label)}</button>`;
}

function counts(findings: RankedFinding[], key: "verdict" | "severity"): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of findings) out.set(f[key], (out.get(f[key]) ?? 0) + 1);
  return out;
}

export function renderReport(report: SessionReport, generatedAt = new Date()): string {
  const confirmed = report.findings.filter((f) => f.verdict === "confirmed").length;
  const vendors = report.vendorsHeard;

  const wire = report.findings.map((f) => ({
    verdict: f.verdict,
    severity: f.severity,
    title: f.title,
    file: f.file,
    ...(f.line != null ? { line: f.line } : {}),
    ...(f.detail ? { detail: f.detail } : {}),
    agreement: f.agreement,
    raisedBy: f.raisedBy,
    ...(f.disputedBy ? { disputedBy: f.disputedBy } : {}),
  }));

  // A `</script>` inside the data would close the tag early. The escape is
  // invisible to JSON.parse but keeps the HTML parser from bailing out.
  const json = JSON.stringify({ findings: wire }).replace(/</g, "\\u003c");

  const verdictChips = [...counts(report.findings, "verdict")]
    .map(([v, n]) => chip("verdict", v, `${v} (${n})`, v))
    .join("");
  const severityChips = [...counts(report.findings, "severity")]
    .map(([s, n]) => chip("severity", s, `${s} (${n})`))
    .join("");

  const notes: string[] = [];
  if (vendors.length < 2) {
    notes.push(
      `Only ${vendors.length || "no"} vendor${vendors.length === 1 ? "" : "s"} reviewed this. ` +
        "Cross-vendor agreement needs at least two different labs, so nothing here can be CONFIRMED.",
    );
  }
  for (const chain of report.fellBack ?? []) {
    notes.push(`A reviewer seat fell back: ${chain}. The run differed from what was configured.`);
  }
  for (const run of report.reviews.filter((r) => !r.ok)) {
    notes.push(`${run.agent} did not deliver a review: ${run.error ?? "failed"}.`);
  }

  const roster = report.reviews
    .map(
      (r) =>
        `<div class="rev"><span>${r.ok ? "✓" : "✗"}</span><span>${esc(r.agent)}</span>` +
        `<span class="v">${esc(r.vendor)} · ${r.role}${r.ok ? "" : ` · ${esc(r.error ?? "failed")}`}</span></div>`,
    )
    .join("");

  const title = report.task ? esc(report.task) : "Code review";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Crosscheck</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>${title}</h1>
  <p class="sub">Reviewed independently by ${vendors.length ? esc(vendors.join(", ")) : "no vendors"} ·
    ${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</p>
  <ul class="stats">
    <li><div>${report.findings.length}</div><span>findings</span></li>
    <li><div>${confirmed}</div><span>confirmed</span></li>
    <li><div>${vendors.length}</div><span>vendors</span></li>
  </ul>
  <div class="actions"><button class="act" id="print">Save as PDF</button></div>
</header>

${notes.map((n) => `<div class="note">${esc(n)}</div>`).join("")}

${
  report.findings.length
    ? `<div class="controls">
  <div class="chips">${verdictChips}</div>
  <div class="chips" style="margin-top:7px">${severityChips}</div>
</div>
<p class="sub" id="count"></p>`
    : `<p class="sub" id="count"></p>`
}

<main id="list"></main>

<section class="roster">
  <h3>Reviewers</h3>
  ${roster || '<div class="rev"><span class="v">none</span></div>'}
</section>

<footer>
  CONFIRMED means agents from two or more different labs raised it independently.
  DISPUTED means one raised it while others reviewed the same file and did not.
  Generated by <a href="https://github.com/deliseph/crosscheck">Crosscheck</a>.
</footer>
</div>

<script type="application/json" id="report-data">${json}</script>
<script>${SCRIPT}</script>
</body>
</html>`;
}

export async function writeReport(
  report: SessionReport,
  path: string,
  generatedAt?: Date,
): Promise<void> {
  await writeFile(path, renderReport(report, generatedAt), "utf8");
}
