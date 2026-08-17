import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The guarantee that makes this tool safe to run.
 *
 * Radar reads public search APIs and writes you a digest. It must never gain
 * the ability to post, vote, comment, or message — not because that would be
 * rude, but because automated posting gets you domain-banned on Hacker News,
 * silently shadowbanned on Reddit, and defederated across Mastodon, and it
 * would invalidate a Claude for Open Source application besides.
 *
 * This test fails the build if that capability ever creeps in.
 */

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** Patterns that would indicate the tool can mutate something remotely. */
const FORBIDDEN: [RegExp, string][] = [
  [/method\s*:\s*["'`](POST|PUT|PATCH|DELETE)/i, "a mutating HTTP method"],
  [/\.(post|put|patch|delete)\s*\(/, "a mutating HTTP client call"],
  [/reddit\.com\/api\/(submit|comment|vote|compose)/i, "a Reddit write endpoint"],
  [/news\.ycombinator\.com\/(submit|comment|vote|reply)/i, "a Hacker News write endpoint"],
  [/\/api\/v1\/statuses/i, "a Mastodon posting endpoint"],
  [/oauth\/(authorize|token)/i, "an OAuth flow (Radar needs no write scope)"],
];

describe("radar cannot write anywhere", () => {
  it("contains no posting, voting or mutating code", async () => {
    const files = await sourceFiles(new URL("../src", import.meta.url).pathname);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const [pattern, what] of FORBIDDEN) {
        if (pattern.test(text)) violations.push(`${file}: ${what}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("exposes only a GET helper, with no method or body parameter", async () => {
    const http = await readFile(new URL("../src/sources/http.ts", import.meta.url), "utf8");

    // The single network entry point takes a URL and headers. Nothing else.
    expect(http).toContain("export async function getJson");
    expect(http).not.toMatch(/\bbody\s*:/);
    expect(http).not.toMatch(/method\s*:/);
  });

  it("sends a descriptive User-Agent, which Reddit requires", async () => {
    const http = await readFile(new URL("../src/sources/http.ts", import.meta.url), "utf8");
    expect(http).toMatch(/user-agent/i);
    expect(http).toContain("archivore-radar");
  });

  it("paces requests rather than hammering the sources", async () => {
    const http = await readFile(new URL("../src/sources/http.ts", import.meta.url), "utf8");
    expect(http).toMatch(/MIN_GAP_MS\s*=\s*\d{4,}/);
  });
});
