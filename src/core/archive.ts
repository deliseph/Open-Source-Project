import { mkdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";

import type { Source } from "./source.js";
import type { ArchiveStats, Entry, ParseResult, Profile, Warning } from "./types.js";

export interface BuildOptions {
  /** Directory the archive is written to. Created if missing. */
  outDir: string;
  /** Copy media files out of the export into the archive. Default true. */
  copyMedia?: boolean;
  /** Called as work progresses, for CLI output. */
  onProgress?: (message: string) => void;
}

export interface ArchiveBundle {
  profiles: Profile[];
  entries: Entry[];
  stats: ArchiveStats;
}

/** Media referenced by URL lives on the platform's servers, not in the ZIP. */
function isRemote(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

/**
 * De-duplicates by entry id.
 *
 * Re-importing an overlapping export is normal — people download Instagram
 * twice a year — and ids are content-derived, so the second copy collapses
 * into the first instead of doubling the archive.
 */
function dedupe(entries: Entry[]): Entry[] {
  const seen = new Map<string, Entry>();
  for (const entry of entries) {
    const existing = seen.get(entry.id);
    // Prefer whichever copy carries media; exports vary in completeness.
    if (!existing || (existing.media.length === 0 && entry.media.length > 0)) {
      seen.set(entry.id, entry);
    }
  }
  return [...seen.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function summarise(entries: Entry[], warnings: Warning[], media: number, bytes: number): ArchiveStats {
  const byPlatform: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let earliest: Date | undefined;
  let latest: Date | undefined;

  for (const entry of entries) {
    byPlatform[entry.platform] = (byPlatform[entry.platform] ?? 0) + 1;
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    if (!earliest || entry.createdAt < earliest) earliest = entry.createdAt;
    if (!latest || entry.createdAt > latest) latest = entry.createdAt;
  }

  return {
    entries: entries.length,
    media,
    mediaBytes: bytes,
    byPlatform,
    byKind,
    ...(earliest ? { earliest } : {}),
    ...(latest ? { latest } : {}),
    warnings,
  };
}

/**
 * Merges parsed results into one archive on disk.
 *
 * Media is copied rather than referenced so the output folder is portable —
 * you can move it to an external drive and it still works.
 */
export async function build(
  inputs: { source: Source; result: ParseResult }[],
  options: BuildOptions,
): Promise<ArchiveBundle> {
  const { outDir, copyMedia = true, onProgress } = options;
  await mkdir(outDir, { recursive: true });

  const entries = dedupe(inputs.flatMap((i) => i.result.entries));
  const profiles = inputs.map((i) => i.result.profile);
  const warnings = inputs.flatMap((i) => i.result.warnings);

  // Map each entry back to the source it came from, so media copying knows
  // which ZIP to pull bytes out of.
  const sourceByPlatform = new Map<string, Source>();
  for (const input of inputs) sourceByPlatform.set(input.result.profile.platform, input.source);

  let copied = 0;
  let bytes = 0;
  let missing = 0;

  if (copyMedia) {
    for (const entry of entries) {
      const source = sourceByPlatform.get(entry.platform);
      if (!source) continue;

      for (const item of entry.media) {
        if (isRemote(item.sourcePath)) continue;
        if (!(await source.exists(item.sourcePath))) {
          missing++;
          continue;
        }

        const relative = posix.join("media", entry.platform, item.sourcePath);
        try {
          bytes += await source.copyTo(item.sourcePath, join(outDir, relative));
          item.archivePath = relative;
          copied++;
          if (copied % 250 === 0) onProgress?.(`  copied ${copied} media files…`);
        } catch (error) {
          warnings.push({
            platform: entry.platform,
            message: `Could not copy media (${(error as Error).message})`,
            path: item.sourcePath,
          });
        }
      }
    }
  }

  if (missing > 0) {
    warnings.push({
      platform: "archivore",
      message: `${missing} media file(s) were referenced but not present in the export. This usually means the export was downloaded in parts and one part is missing.`,
    });
  }

  const stats = summarise(entries, warnings, copied, bytes);
  return { profiles, entries, stats };
}

/** Writes the canonical machine-readable archive. */
export async function writeJson(bundle: ArchiveBundle, outDir: string): Promise<string> {
  const path = join(outDir, "archive.json");
  const payload = {
    format: "archivore/v1",
    generatedAt: new Date().toISOString(),
    profiles: bundle.profiles,
    stats: bundle.stats,
    entries: bundle.entries,
  };
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}
