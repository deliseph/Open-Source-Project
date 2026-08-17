#!/usr/bin/env node
import { parseArgs } from "node:util";

import { build, writeJson } from "./core/archive.js";
import { adapters, detect, findAdapter, parseWith } from "./core/registry.js";
import { openSource, type Source } from "./core/source.js";
import type { ParseResult } from "./core/types.js";
import { formatBytes } from "./core/util.js";
import { writeHtml } from "./export/html.js";
import { writeMarkdown } from "./export/markdown.js";

const HELP = `
archivore — turn social media export ZIPs into one archive you own.

USAGE
  archivore build <export...> [options]
  archivore inspect <export>
  archivore platforms

COMMANDS
  build       Read one or more exports and write a browsable archive.
  inspect     Say what an export is and what's in it, without writing anything.
  platforms   List supported platforms and where to request each export.

OPTIONS
  -o, --out <dir>     Where to write the archive        (default: ./archive)
      --platform <id> Skip detection and force an adapter
      --no-media      Don't copy media files (much faster, much smaller)
      --markdown      Also write one Markdown file per month
      --json-only     Skip the HTML page
  -h, --help          Show this message
  -v, --version       Show the version

Archivore never makes a network request. Everything happens on your machine.

EXAMPLES
  archivore build instagram.zip
  archivore build instagram.zip tiktok.zip x-archive/ -o ~/my-archive --markdown
  archivore inspect ~/Downloads/snapchat.zip
`;

const VERSION = "0.1.0";

function fail(message: string): never {
  process.stderr.write(`\nerror: ${message}\n\nRun \`archivore --help\` for usage.\n`);
  process.exit(1);
}

/** Opens a source and works out which adapter reads it. */
async function resolve(
  path: string,
  forced: string | undefined,
): Promise<{ source: Source; result: ParseResult; name: string }> {
  const source = await openSource(path);

  const adapter = forced ? findAdapter(forced) : (await detect(source))[0]?.adapter;
  if (forced && !adapter) {
    await source.close();
    fail(`Unknown platform "${forced}". Run \`archivore platforms\` to see the list.`);
  }
  if (!adapter) {
    await source.close();
    fail(
      `Could not tell what "${path}" is an export of.\n` +
        `       Point at the folder or .zip exactly as the platform gave it to you,\n` +
        `       or force one with --platform. Run \`archivore platforms\` for ids.`,
    );
  }

  const result = await parseWith(adapter, source);
  return { source, result, name: adapter.name };
}

async function commandInspect(path: string, forced: string | undefined): Promise<void> {
  const { source, result, name } = await resolve(path, forced);
  const who = result.profile.handle ? ` (@${result.profile.handle})` : "";

  process.stdout.write(`\n${name}${who}\n`);
  process.stdout.write(`${result.entries.length.toLocaleString()} entries\n\n`);

  const byKind: Record<string, number> = {};
  let media = 0;
  for (const entry of result.entries) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    media += entry.media.length;
  }
  for (const [kind, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${String(n).padStart(7)}  ${kind}\n`);
  }
  process.stdout.write(`  ${String(media).padStart(7)}  media references\n`);

  if (result.entries.length > 0) {
    const last = result.entries[0]?.createdAt;
    const first = result.entries[result.entries.length - 1]?.createdAt;
    if (first && last) {
      process.stdout.write(
        `\n  ${first.toISOString().slice(0, 10)} → ${last.toISOString().slice(0, 10)}\n`,
      );
    }
  }

  for (const warning of result.warnings) {
    process.stdout.write(`\n  ! ${warning.message}${warning.path ? `\n    ${warning.path}` : ""}\n`);
  }
  process.stdout.write("\n");
  await source.close();
}

async function commandBuild(
  paths: string[],
  options: {
    out: string;
    platform: string | undefined;
    media: boolean;
    markdown: boolean;
    jsonOnly: boolean;
  },
): Promise<void> {
  const inputs: { source: Source; result: ParseResult }[] = [];

  for (const path of paths) {
    process.stdout.write(`reading ${path}…\n`);
    const { source, result, name } = await resolve(path, options.platform);
    process.stdout.write(`  ${name}: ${result.entries.length.toLocaleString()} entries\n`);
    inputs.push({ source, result });
  }

  const bundle = await build(inputs, {
    outDir: options.out,
    copyMedia: options.media,
    onProgress: (message) => process.stdout.write(`${message}\n`),
  });

  await writeJson(bundle, options.out);
  if (!options.jsonOnly) await writeHtml(bundle, options.out);
  if (options.markdown) {
    const months = await writeMarkdown(bundle, options.out);
    process.stdout.write(`  wrote ${months} monthly Markdown files\n`);
  }

  for (const source of inputs) await source.source.close();

  const { stats } = bundle;
  process.stdout.write(
    `\ndone — ${stats.entries.toLocaleString()} entries, ` +
      `${stats.media.toLocaleString()} media files (${formatBytes(stats.mediaBytes)})\n`,
  );

  if (stats.warnings.length > 0) {
    process.stdout.write(`\n${stats.warnings.length} thing(s) worth knowing:\n`);
    for (const warning of stats.warnings.slice(0, 10)) {
      process.stdout.write(`  ! [${warning.platform}] ${warning.message}\n`);
    }
    if (stats.warnings.length > 10) {
      process.stdout.write(`  … and ${stats.warnings.length - 10} more (see archive.json)\n`);
    }
  }

  if (!options.jsonOnly) {
    process.stdout.write(`\nopen ${options.out}/index.html to browse it.\n`);
  }
}

function commandPlatforms(): void {
  process.stdout.write("\nSupported platforms:\n\n");
  for (const adapter of adapters) {
    process.stdout.write(`  ${adapter.id.padEnd(10)} ${adapter.name}\n`);
    if (adapter.requestUrl) process.stdout.write(`  ${" ".repeat(10)} ${adapter.requestUrl}\n`);
  }
  process.stdout.write(
    "\nExports take anywhere from minutes to four days to arrive. Request them all now,\n" +
      "then run `archivore build` once they land.\n\n",
  );
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        out: { type: "string", short: "o", default: "./archive" },
        platform: { type: "string" },
        media: { type: "boolean", default: true },
        markdown: { type: "boolean", default: false },
        "json-only": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    fail((error as Error).message);
  }

  const { values, positionals } = parsed;
  if (values.version) return void process.stdout.write(`${VERSION}\n`);
  if (values.help || positionals.length === 0) return void process.stdout.write(HELP);

  const [command, ...rest] = positionals;

  switch (command) {
    case "platforms":
      return commandPlatforms();

    case "inspect": {
      const target = rest[0];
      if (!target) fail("`inspect` needs a path to an export.");
      return commandInspect(target, values.platform);
    }

    case "build": {
      if (rest.length === 0) fail("`build` needs at least one export to read.");
      return commandBuild(rest, {
        out: values.out,
        platform: values.platform,
        media: values.media,
        markdown: values.markdown,
        jsonOnly: values["json-only"],
      });
    }

    default:
      fail(`Unknown command "${command}".`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nerror: ${message}\n`);
  process.exit(1);
});
