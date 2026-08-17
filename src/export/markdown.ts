import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ArchiveBundle } from "../core/archive.js";
import type { Entry } from "../core/types.js";

/**
 * Writes the archive as one Markdown file per month.
 *
 * Monthly files keep each one small enough to open, and the folder drops
 * straight into Obsidian, Logseq or a plain git repo — which is the point:
 * the archive should outlive this tool.
 */

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Escapes the characters that would otherwise become Markdown formatting. */
function escapeMd(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1");
}

function renderEntry(entry: Entry): string {
  const time = entry.createdAt.toISOString().replace("T", " ").slice(0, 16);
  const lines = [`### ${time} · ${entry.platform} · ${entry.kind}`, ""];

  if (entry.thread?.from) lines.push(`**From:** ${escapeMd(entry.thread.from)}`, "");
  if (entry.text) lines.push(escapeMd(entry.text), "");

  for (const item of entry.media) {
    const path = item.archivePath ?? item.sourcePath;
    // Relative to the markdown/<year>/ folder the file is written into.
    const href = /^https?:/i.test(path) ? path : `../../${path}`;
    lines.push(item.kind === "image" ? `![](${href})` : `[${item.kind}](${href})`, "");
  }

  if (entry.url) lines.push(`[Original](${entry.url})`, "");
  lines.push("---", "");
  return lines.join("\n");
}

export async function writeMarkdown(bundle: ArchiveBundle, outDir: string): Promise<number> {
  const byMonth = new Map<string, Entry[]>();
  for (const entry of bundle.entries) {
    const key = monthKey(entry.createdAt);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(entry);
    else byMonth.set(key, [entry]);
  }

  for (const [month, entries] of byMonth) {
    const year = month.slice(0, 4);
    const dir = join(outDir, "markdown", year);
    await mkdir(dir, { recursive: true });

    // Oldest first reads like a diary, which is how people scan these.
    const ordered = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const body = [`# ${month}`, "", ...ordered.map(renderEntry)].join("\n");
    await writeFile(join(dir, `${month}.md`), body, "utf8");
  }

  return byMonth.size;
}
