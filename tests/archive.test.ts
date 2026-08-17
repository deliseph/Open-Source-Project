import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { build, writeJson } from "../src/core/archive.js";
import { parseWith } from "../src/core/registry.js";
import { DirectorySource, ZipSource, openSource } from "../src/core/source.js";
import type { ParseResult } from "../src/core/types.js";
import { instagram } from "../src/adapters/instagram.js";
import { x } from "../src/adapters/x.js";
import { writeHtml } from "../src/export/html.js";
import { writeMarkdown } from "../src/export/markdown.js";

import { instagramExport, tempDir, xExport } from "./fixtures.js";

const run = promisify(execFile);

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Zips a folder so the ZipSource path gets exercised, not just directories. */
async function zipUp(root: string): Promise<string> {
  const out = join(await tempDir(), "export.zip");
  await run("zip", ["-r", "-q", out, "."], { cwd: root });
  return out;
}

describe("ZipSource", () => {
  it("reads a zipped export the same way as a folder", async () => {
    const root = await instagramExport();
    const zip = await ZipSource.open(await zipUp(root));

    try {
      const fromZip = await parseWith(instagram, zip);
      const fromDir = await parseWith(instagram, new DirectorySource(root));

      expect(fromZip.entries.map((e) => e.id)).toEqual(fromDir.entries.map((e) => e.id));
      expect(fromZip.profile).toEqual(fromDir.profile);
      // The mojibake repair has to survive the ZIP round trip too.
      expect(fromZip.entries.map((e) => e.text)).toContain("café 😀");
    } finally {
      await zip.close();
    }
  });

  it("is chosen automatically for a .zip path", async () => {
    const source = await openSource(await zipUp(await instagramExport()));
    expect(source).toBeInstanceOf(ZipSource);
    await source.close();
  });
});

describe("build", () => {
  async function buildAll(outDir: string) {
    const igRoot = await instagramExport();
    const xRoot = await xExport();

    const inputs: { source: DirectorySource; result: ParseResult }[] = [];
    for (const [adapter, root] of [
      [instagram, igRoot],
      [x, xRoot],
    ] as const) {
      const source = new DirectorySource(root);
      inputs.push({ source, result: await parseWith(adapter, source) });
    }
    return build(inputs, { outDir });
  }

  it("merges platforms into one timeline, newest first", async () => {
    const out = await tempDir();
    const bundle = await buildAll(out);

    const platforms = new Set(bundle.entries.map((e) => e.platform));
    expect(platforms).toEqual(new Set(["instagram", "x"]));

    const times = bundle.entries.map((e) => e.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("copies media into the archive and records where it went", async () => {
    const out = await tempDir();
    const bundle = await buildAll(out);

    expect(bundle.stats.media).toBe(4);
    expect(bundle.stats.mediaBytes).toBeGreaterThan(0);

    const copied = bundle.entries.flatMap((e) => e.media).filter((m) => m.archivePath);
    expect(copied.length).toBe(4);

    for (const item of copied) {
      expect(await exists(join(out, item.archivePath!))).toBe(true);
    }
    expect(
      await exists(join(out, "media/instagram/media/posts/202401/photo1.jpg")),
    ).toBe(true);
  });

  it("de-duplicates when the same export is read twice", async () => {
    const root = await instagramExport();
    const source = new DirectorySource(root);
    const result = await parseWith(instagram, source);

    const once = await build([{ source, result }], { outDir: await tempDir() });
    const twice = await build(
      [
        { source, result },
        { source, result: await parseWith(instagram, source) },
      ],
      { outDir: await tempDir() },
    );

    expect(twice.entries.length).toBe(once.entries.length);
  });

  it("skips media copying when asked", async () => {
    const out = await tempDir();
    const source = new DirectorySource(await instagramExport());
    const result = await parseWith(instagram, source);

    const bundle = await build([{ source, result }], { outDir: out, copyMedia: false });
    expect(bundle.stats.media).toBe(0);
    expect(await exists(join(out, "media"))).toBe(false);
  });
});

describe("exporters", () => {
  it("writes archive.json in a documented, stable shape", async () => {
    const out = await tempDir();
    const source = new DirectorySource(await instagramExport());
    const bundle = await build([{ source, result: await parseWith(instagram, source) }], {
      outDir: out,
    });

    await writeJson(bundle, out);
    const parsed = JSON.parse(await readFile(join(out, "archive.json"), "utf8"));

    expect(parsed.format).toBe("archivore/v1");
    expect(parsed.entries.length).toBe(bundle.entries.length);
    expect(parsed.profiles[0].platform).toBe("instagram");
    // `raw` is kept so nothing from the original export is lost.
    expect(parsed.entries.some((e: { raw?: unknown }) => e.raw != null)).toBe(true);
  });

  it("writes a self-contained HTML page with no external requests", async () => {
    const out = await tempDir();
    const source = new DirectorySource(await instagramExport());
    const bundle = await build([{ source, result: await parseWith(instagram, source) }], {
      outDir: out,
    });

    await writeHtml(bundle, out);
    const html = await readFile(join(out, "index.html"), "utf8");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("café 😀");
    // Nothing may be loaded from the network — that is the core promise.
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=["']https?:/i);
    expect(html).not.toContain("fetch(");
  });

  it("escapes markup so a caption cannot break out of the page", async () => {
    const out = await tempDir();
    const source = new DirectorySource(await instagramExport());
    const bundle = await build([{ source, result: await parseWith(instagram, source) }], {
      outDir: out,
    });

    bundle.entries[0]!.text = '</script><script>alert(1)</script>';
    await writeHtml(bundle, out);
    const html = await readFile(join(out, "index.html"), "utf8");

    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });

  it("writes one Markdown file per month", async () => {
    const out = await tempDir();
    const source = new DirectorySource(await instagramExport());
    const bundle = await build([{ source, result: await parseWith(instagram, source) }], {
      outDir: out,
    });

    const months = await writeMarkdown(bundle, out);
    expect(months).toBeGreaterThan(0);
    expect(await exists(join(out, "markdown/2024/2024-01.md"))).toBe(true);

    const body = await readFile(join(out, "markdown/2024/2024-01.md"), "utf8");
    expect(body).toContain("# 2024-01");
    expect(body).toContain("café 😀");
  });
});
