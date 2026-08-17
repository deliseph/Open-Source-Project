#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { dedupeLeads, render, toLeads } from "./digest.js";
import { ARCHIVORE_LEADS, CROSSCHECK_LEADS, mentionQueries } from "./queries.js";
import * as hn from "./sources/hn.js";
import * as reddit from "./sources/reddit.js";
import { assessEligibility, fetchStats } from "./sources/github.js";
import { HttpError } from "./sources/http.js";
import { Store } from "./store.js";
import type { Hit, Lead, Query } from "./types.js";

const HELP = `
radar — find the conversations, so a human can join them.

Radar reads public search APIs and writes you a digest of threads where you
could genuinely help. It never posts, votes, or messages anyone. There is no
posting code in it and no credential that could write anywhere.

USAGE
  radar leads [--project archivore|crosscheck] [--days 365] [--out FILE]
  radar mentions [--days 30] [--out FILE]
  radar stats [--repo owner/name]

OPTIONS
  --project <name>   Which lead set to use          (default: archivore)
  --repo <o/n>       Repository for stats/mentions  (default: deliseph/archivore)
  --days <n>         How far back to look
  --all              Include threads shown in a previous run
  --out <file>       Write the digest to a file instead of stdout
  --min <0-1>        Relevance threshold            (default: 0.45)

WHY THIS SHAPE
  Automated posting gets you domain-banned on HN, silently shadowbanned on
  Reddit, and defederated on Mastodon. It would also invalidate a Claude for
  Open Source application, which is assessed by a human looking at whether
  real people use and contribute to your project.

  Answering questions people actually asked is slower, works, and those
  threads keep ranking in search for years.

EXAMPLES
  radar leads --days 730 --out leads.md
  radar mentions --days 7
  radar stats
`;

const DEFAULT_REPO = "deliseph/archivore";

function fail(message: string): never {
  process.stderr.write(`\nerror: ${message}\n`);
  process.exit(1);
}

/** Runs one query across every source, tolerating a source being down. */
async function gather(query: Query, days: number, warn: (m: string) => void): Promise<Hit[]> {
  const hits: Hit[] = [];

  for (const term of query.terms) {
    try {
      hits.push(...(await hn.search(term, days)));
    } catch (error) {
      warn(`hn "${term}": ${error instanceof HttpError ? error.message : String(error)}`);
    }

    try {
      hits.push(...(await reddit.search(term, query.subreddits, days)));
    } catch (error) {
      warn(`reddit "${term}": ${error instanceof HttpError ? error.message : String(error)}`);
    }
  }
  return hits;
}

async function commandLeads(
  queries: Query[],
  title: string,
  opts: { days: number; all: boolean; min: number; out?: string },
): Promise<void> {
  const store = new Store(".radar/state.json");
  await store.load();

  const warnings: string[] = [];
  const warn = (m: string): void => {
    warnings.push(m);
  };

  const leads: Lead[] = [];
  for (const query of queries) {
    const days = Math.min(opts.days, query.maxAgeDays ?? opts.days);
    process.stderr.write(`searching: ${query.topic}…\n`);

    const hits = await gather(query, days, warn);
    const fresh = opts.all ? hits : hits.filter((h) => store.isNew(h.id));
    leads.push(...toLeads(fresh, query, opts.min));
  }

  // Queries overlap, so a thread can match several topics. Show it once,
  // under whichever topic fits best.
  const unique = dedupeLeads(leads);

  // Only remember what was actually shown, so raising --min later can still
  // surface a thread that was previously filtered out.
  store.markSeen(unique.map((l) => l.hit.id));
  await store.save();

  const digest = render(unique, title);
  if (opts.out) {
    await writeFile(opts.out, digest, "utf8");
    process.stderr.write(`\nwrote ${opts.out} (${unique.length} leads)\n`);
  } else {
    process.stdout.write("\n" + digest);
  }

  if (warnings.length) {
    process.stderr.write(`\n${warnings.length} source error(s):\n`);
    for (const w of warnings.slice(0, 5)) process.stderr.write(`  ! ${w}\n`);
  }
}

async function commandStats(repo: string): Promise<void> {
  const store = new Store(".radar/state.json");
  await store.load();

  let stats;
  try {
    stats = await fetchStats(repo);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      fail(`No such repository: ${repo}. Has it been renamed or is it still private?`);
    }
    if (error instanceof HttpError && error.status === 403) {
      fail("GitHub rate limit reached. Set GITHUB_TOKEN for a higher limit.");
    }
    throw error;
  }

  store.recordStats(stats.stars, stats.outsideContributors);
  const previous = store.previousStats();
  await store.save();

  const delta = (now: number, before?: number): string =>
    before == null ? "" : now === before ? " (no change)" : ` (${now > before ? "+" : ""}${now - before})`;

  process.stdout.write(`\n${repo}\n\n`);
  process.stdout.write(
    `  ${String(stats.outsideContributors).padStart(6)}  outside contributors${delta(stats.outsideContributors, previous?.outsideContributors)}\n`,
  );
  process.stdout.write(`  ${String(stats.stars).padStart(6)}  stars${delta(stats.stars, previous?.stars)}\n`);
  process.stdout.write(`  ${String(stats.forks).padStart(6)}  forks\n`);
  process.stdout.write(`  ${String(stats.openIssues).padStart(6)}  open issues\n`);

  if (stats.contributors.length) {
    process.stdout.write(`\n  contributors: ${stats.contributors.join(", ")}\n`);
  }

  process.stdout.write("\n");
  for (const note of assessEligibility(stats)) process.stdout.write(`  • ${note}\n`);
  process.stdout.write("\n");
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        project: { type: "string", default: "archivore" },
        repo: { type: "string", default: DEFAULT_REPO },
        days: { type: "string", default: "365" },
        all: { type: "boolean", default: false },
        min: { type: "string", default: "0.45" },
        out: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    fail((error as Error).message);
  }

  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) return void process.stdout.write(HELP);

  const days = Number(values.days);
  const min = Number(values.min);
  if (!Number.isFinite(days) || days <= 0) fail("--days must be a positive number.");
  if (!Number.isFinite(min) || min < 0 || min > 1) fail("--min must be between 0 and 1.");

  const shared = { days, all: values.all, min, ...(values.out ? { out: values.out } : {}) };

  switch (positionals[0]) {
    case "leads": {
      const sets: Record<string, Query[]> = {
        archivore: ARCHIVORE_LEADS,
        crosscheck: CROSSCHECK_LEADS,
      };
      const queries = sets[values.project];
      if (!queries) fail(`Unknown project "${values.project}". Try: ${Object.keys(sets).join(", ")}`);
      return commandLeads(queries, `Leads — ${values.project}`, shared);
    }

    case "mentions": {
      const names = values.project === "crosscheck" ? ["crosscheck cli"] : ["archivore"];
      return commandLeads(mentionQueries(values.repo, names), "Mentions", shared);
    }

    case "stats":
      return commandStats(values.repo);

    default:
      fail(`Unknown command "${positionals[0]}".`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\nerror: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
