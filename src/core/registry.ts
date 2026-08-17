import type { Adapter } from "./adapter.js";
import { WarningCollector } from "./adapter.js";
import type { Source } from "./source.js";
import type { ParseResult } from "./types.js";

import { instagram } from "../adapters/instagram.js";
import { mastodon } from "../adapters/mastodon.js";
import { snapchat } from "../adapters/snapchat.js";
import { tiktok } from "../adapters/tiktok.js";
import { x } from "../adapters/x.js";

/**
 * Every adapter Archivore ships with.
 *
 * Adding one here plus a file in src/adapters is the whole integration.
 */
export const adapters: readonly Adapter[] = [instagram, x, tiktok, snapchat, mastodon];

export function findAdapter(id: string): Adapter | undefined {
  return adapters.find((a) => a.id === id.toLowerCase());
}

export interface Detection {
  adapter: Adapter;
  confidence: number;
}

/**
 * Scores every adapter against a source, best match first.
 *
 * Detection runs in parallel because each adapter only reads the file listing
 * and a marker file or two.
 */
export async function detect(source: Source): Promise<Detection[]> {
  const scored = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        return { adapter, confidence: await adapter.detect(source) };
      } catch {
        // A detector that throws is a broken adapter, not a broken export.
        return { adapter, confidence: 0 };
      }
    }),
  );
  return scored.filter((d) => d.confidence > 0).sort((a, b) => b.confidence - a.confidence);
}

/** Runs one adapter over a source with a fresh warning collector. */
export async function parseWith(adapter: Adapter, source: Source): Promise<ParseResult> {
  return adapter.parse(source, new WarningCollector(adapter.id));
}
