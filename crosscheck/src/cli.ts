#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { BUILTIN_AGENTS, buildInvocation, findAgent, resolveAgents } from "./core/agents.js";
import { captureDiff, estimateTokens, isRepo } from "./core/git.js";
import { isInstalled } from "./core/run.js";
import { buildAndReview, review } from "./core/session.js";
import type { AgentSpec, SessionReport, TeamConfig } from "./core/types.js";
import { isHttp } from "./core/types.js";
import { Office, printReport } from "./ui/office.js";

const VERSION = "0.1.0";

const HELP = `
crosscheck — an office for your AI coding agents.

One agent writes the code. Agents from other vendors review it. Findings that
two different labs independently agree on are the ones worth your attention.

USAGE
  crosscheck review [options]            Review your current changes
  crosscheck build "<task>" [options]    One agent writes it, the others review
  crosscheck doctor                      Which agents are installed?
  crosscheck init                        Write a crosscheck.json to edit

OPTIONS
  -r, --reviewers <ids>   Comma-separated, e.g. codex,gemini
  -a, --author <id>       Agent that writes the code (build only)
      --base <ref>        Review branch against this ref instead of the worktree
      --json <file>       Also write the full report as JSON
      --keep-worktree     Don't delete the author's worktree (build only)
      --plain             No live office view
  -h, --help / -v, --version

Agents are configured in crosscheck.json. Run \`crosscheck init\` to start.

EXAMPLES
  crosscheck review                            # review what you've just written
  crosscheck review -r codex,gemini --base main
  crosscheck build "add retry with backoff to the client" -a claude -r codex,gemini
`;

function fail(message: string): never {
  process.stderr.write(`\nerror: ${message}\n\nRun \`crosscheck --help\` for usage.\n`);
  process.exit(1);
}

async function loadConfig(cwd: string): Promise<TeamConfig | undefined> {
  for (const name of ["crosscheck.json", ".crosscheck.json"]) {
    try {
      return JSON.parse(await readFile(join(cwd, name), "utf8")) as TeamConfig;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        fail(`${name} is not valid JSON: ${(error as Error).message}`);
      }
    }
  }
  return undefined;
}

/** Turns comma-separated ids into specs, failing loudly on a typo. */
function pick(agents: AgentSpec[], ids: string[], label: string): AgentSpec[] {
  const picked: AgentSpec[] = [];
  for (const id of ids) {
    const spec = findAgent(agents, id);
    if (!spec) {
      fail(`Unknown ${label} "${id}". Known agents: ${agents.map((a) => a.id).join(", ")}`);
    }
    picked.push(spec);
  }
  return picked;
}

function warnSingleVendor(reviewers: AgentSpec[]): void {
  const vendors = new Set(reviewers.map((r) => r.vendor));
  if (reviewers.length > 1 && vendors.size === 1) {
    process.stderr.write(
      `\nwarning: every reviewer is from ${[...vendors][0]}. Agreement between agents from\n` +
        `         the same lab is repetition, not corroboration — nothing will be marked\n` +
        `         CONFIRMED. Add a reviewer from a different vendor.\n`,
    );
  }
}

function attachOffice(office: Office, specs: AgentSpec[]) {
  return {
    onStart: (spec: AgentSpec) => office.update(spec.id, "working", "thinking"),
    onFinish: (spec: AgentSpec, run: { ok: boolean; error?: string }, findings: number) => {
      if (!run.ok) office.update(spec.id, "failed", run.error ?? "failed");
      else if (spec.id === specs[0]?.id && findings === 0) office.update(spec.id, "done", "done");
      else office.update(spec.id, "done", findings === 0 ? "looks good" : `${findings} found`);
    },
  };
}

async function writeJsonReport(report: SessionReport, path: string): Promise<void> {
  // The diff can be enormous; the findings are the point.
  const { diff, ...rest } = report;
  await writeFile(path, JSON.stringify({ ...rest, diffBytes: diff.length }, null, 2), "utf8");
  process.stdout.write(`\nwrote ${path}\n`);
}

async function commandDoctor(cwd: string): Promise<void> {
  const agents = resolveAgents(await loadConfig(cwd));
  process.stdout.write("\nAgents:\n\n");

  for (const spec of agents) {
    const ready = await isInstalled(spec);
    const mark = ready ? "\x1b[32m\u2713\x1b[0m" : "\x1b[90m\u00b7\x1b[0m";
    process.stdout.write(`  ${mark} ${spec.id.padEnd(14)} ${spec.name} \x1b[90m(${spec.vendor})\x1b[0m\n`);

    if (isHttp(spec)) {
      process.stdout.write(`    \x1b[90m${spec.model} via ${spec.endpoint}\x1b[0m\n`);
      if (!ready && spec.apiKeyEnv) {
        process.stdout.write(`    \x1b[90mset ${spec.apiKeyEnv}\x1b[0m`);
        process.stdout.write(spec.signup ? ` \x1b[90m\u2014 ${spec.signup}\x1b[0m\n` : "\n");
      }
      if (spec.trainsOnData) {
        process.stdout.write(
          "    \x1b[33mfree tier may train on what you send \u2014 not for private code\x1b[0m\n",
        );
      }
    } else {
      // Show the exact command, so a drifted CLI flag is obvious and fixable.
      const { args, useStdin } = buildInvocation(spec, "<prompt>");
      process.stdout.write(
        `    \x1b[90m${spec.command} ${args.join(" ")}${useStdin ? "  < prompt on stdin" : ""}\x1b[0m\n`,
      );
      if (!ready && spec.install) {
        process.stdout.write(`    \x1b[90minstall: ${spec.install}\x1b[0m\n`);
      }
    }
  }

  const vendors = new Set<string>();
  for (const spec of agents) if (await isInstalled(spec)) vendors.add(spec.vendor);

  process.stdout.write(
    vendors.size >= 2
      ? `\n\x1b[32m${vendors.size} vendors available.\x1b[0m Cross-vendor consensus will work.\n\n`
      : `\n\x1b[33mOnly ${vendors.size} vendor available.\x1b[0m Install an agent from a different lab\n` +
          `to get CONFIRMED findings — that is the whole point of the tool.\n\n`,
  );
}

async function commandInit(cwd: string): Promise<void> {
  const path = join(cwd, "crosscheck.json");
  const config: TeamConfig = {
    author: "claude",
    reviewers: ["codex", "gemini"],
    agents: [],
  };
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  process.stdout.write(
    `\nwrote crosscheck.json\n\n` +
      `Built-in agents: ${BUILTIN_AGENTS.map((a) => a.id).join(", ")}\n` +
      `Add your own, or override a command, in the "agents" array.\n` +
      `Run \`crosscheck doctor\` to check what's installed.\n\n`,
  );
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        reviewers: { type: "string", short: "r" },
        author: { type: "string", short: "a" },
        base: { type: "string" },
        json: { type: "string" },
        "keep-worktree": { type: "boolean", default: false },
        plain: { type: "boolean", default: false },
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

  const cwd = process.cwd();
  const [command, ...rest] = positionals;

  if (command === "doctor") return commandDoctor(cwd);
  if (command === "init") return commandInit(cwd);

  if (command !== "review" && command !== "build") fail(`Unknown command "${command}".`);
  if (!(await isRepo(cwd))) fail("Not a git repository. Crosscheck reviews git diffs.");

  const config = await loadConfig(cwd);
  const agents = resolveAgents(config);

  const reviewerIds = values.reviewers?.split(",").map((s) => s.trim()).filter(Boolean) ??
    config?.reviewers;
  if (!reviewerIds?.length) {
    fail("No reviewers. Pass --reviewers codex,gemini or run `crosscheck init`.");
  }
  const reviewers = pick(agents, reviewerIds, "reviewer");
  warnSingleVendor(reviewers);

  const live = !values.plain;
  let report: SessionReport;

  if (command === "review") {
    const diff = await captureDiff(cwd, values.base);
    if (!diff.trim()) {
      process.stdout.write(
        values.base
          ? `\nNo changes against ${values.base}.\n\n`
          : "\nNo uncommitted changes to review. Use --base main to review a branch.\n\n",
      );
      return;
    }

    const tokens = estimateTokens(diff);
    if (tokens > 100_000) {
      process.stderr.write(
        `\nwarning: this diff is roughly ${Math.round(tokens / 1000)}k tokens and may exceed\n` +
          `         some reviewers' context. Consider reviewing a narrower range.\n`,
      );
    }

    const office = new Office(`reviewing ${Math.round(diff.length / 1024)}KB of changes`, live);
    for (const spec of reviewers) office.add(spec, "reviewer");
    office.start();

    report = await review({ cwd, reviewers, diff, events: attachOffice(office, reviewers) });
    office.stop();
  } else {
    const task = rest.join(" ").trim();
    if (!task) fail('`build` needs a task, e.g. crosscheck build "add retry to the client"');

    const authorId = values.author ?? config?.author;
    if (!authorId) fail("No author. Pass --author claude or set one in crosscheck.json.");
    const [author] = pick(agents, [authorId], "author");

    const office = new Office(task, live);
    office.add(author!, "author");
    for (const spec of reviewers) office.add(spec, "reviewer");
    office.start();

    report = await buildAndReview({
      cwd,
      author: author!,
      task,
      reviewers,
      ...(values["keep-worktree"] ? { keepWorktree: true } : {}),
      events: attachOffice(office, [author!, ...reviewers]),
    });
    office.stop();

    const worktree = (report as { worktreePath?: string }).worktreePath;
    if (values["keep-worktree"] && worktree) {
      process.stdout.write(`\nworktree kept at ${worktree}\n`);
    }
  }

  printReport(report);
  if (values.json) await writeJsonReport(report, values.json);

  // Exit non-zero when vendors agreed something is seriously wrong, so this
  // can gate a commit hook or a CI job.
  const blocking = report.findings.filter(
    (f) => f.verdict === "confirmed" && (f.severity === "critical" || f.severity === "major"),
  );
  if (blocking.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`\nerror: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
