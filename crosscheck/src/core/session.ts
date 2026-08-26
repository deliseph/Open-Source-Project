import { join } from "node:path";
import { tmpdir } from "node:os";

import { rank } from "./consensus.js";
import { parseFindings } from "./findings.js";
import { captureDiff, createWorktree, filesInDiff } from "./git.js";
import { authorPrompt, reviewPrompt } from "./prompts.js";
import { runAgent } from "./run.js";
import type { AgentRun, AgentSpec, Finding, SessionReport } from "./types.js";
import { isHttp } from "./types.js";

/** Progress callbacks, so the office view can show what's happening live. */
export interface SessionEvents {
  onStart?(agent: AgentSpec, role: "author" | "reviewer"): void;
  onOutput?(agent: AgentSpec, chunk: string): void;
  onFinish?(agent: AgentSpec, run: AgentRun, findings: number): void;
  onNote?(message: string): void;
}

export interface ReviewOptions {
  cwd: string;
  reviewers: AgentSpec[];
  /** Pre-captured diff. Omit to read the working tree. */
  diff?: string;
  base?: string;
  task?: string;
  events?: SessionEvents;
  signal?: AbortSignal;
}

/**
 * The vendor that actually answered.
 *
 * A gateway may fall back to a different provider when one is rate-limited.
 * If Crosscheck kept the vendor it *asked* for, two "different vendors"
 * agreeing could be the same model twice — consensus would silently become a
 * lie with no error shown. So the served vendor always wins.
 */
function effectiveVendor(spec: AgentSpec, servedVendor?: string): string {
  return servedVendor ?? spec.vendor;
}

function toRun(
  spec: AgentSpec,
  role: "author" | "reviewer",
  result: {
    ok: boolean;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
    servedVendor?: string;
  },
): AgentRun {
  return {
    agent: spec.id,
    vendor: effectiveVendor(spec, result.servedVendor),
    role,
    ok: result.ok,
    output: result.stdout,
    ...(result.ok
      ? {}
      : { error: result.timedOut ? "timed out" : result.stderr.trim() || "failed" }),
    durationMs: result.durationMs,
  };
}

/**
 * Fans a diff out to every reviewer and reconciles what comes back.
 *
 * Reviewers run concurrently and never see each other's output — that
 * independence is the whole basis for treating agreement as evidence.
 */
export async function review(options: ReviewOptions): Promise<SessionReport> {
  const { cwd, reviewers, base, task, events, signal } = options;

  const diff = options.diff ?? (await captureDiff(cwd, base));
  if (!diff.trim()) {
    return { task: task ?? "", diff: "", reviews: [], findings: [], vendorsHeard: [] };
  }

  const changedFiles = new Set(filesInDiff(diff));
  const prompt = reviewPrompt(diff, task);

  const results = await Promise.all(
    reviewers.map(async (spec) => {
      events?.onStart?.(spec, "reviewer");

      const result = await runAgent(spec, prompt, {
        cwd,
        ...(signal ? { signal } : {}),
        onOutput: (chunk) => events?.onOutput?.(spec, chunk),
      });

      const run = toRun(spec, "reviewer", result);

      // Tell the user when a gateway answered with a different lab than asked
      // for — it changes what the consensus verdicts mean.
      if (result.servedVendor && result.servedVendor !== spec.vendor) {
        events?.onNote?.(
          `${spec.id}: served by ${result.servedVendor} (asked for ${spec.vendor})` +
            (result.servedModel ? ` — ${result.servedModel}` : ""),
        );
      }

      const { findings, hadJson } = result.ok
        ? parseFindings(result.stdout, spec.id, run.vendor)
        : { findings: [] as Finding[], hadJson: false };

      // A reviewer that ran but produced no parseable JSON is not the same as
      // one that found nothing, and must not count as a vendor voice.
      if (result.ok && !hadJson) {
        run.ok = false;
        run.error = "no parseable findings in output";
      }

      events?.onFinish?.(spec, run, findings.length);
      return { run, findings };
    }),
  );

  // Only vendors that actually delivered a review get a vote.
  const reviewedFilesByVendor = new Map<string, Set<string>>();
  for (const { run } of results) {
    if (run.ok) reviewedFilesByVendor.set(run.vendor, changedFiles);
  }

  const findings = rank(
    results.flatMap((r) => r.findings),
    reviewedFilesByVendor,
  );

  return {
    task: task ?? "",
    diff,
    reviews: results.map((r) => r.run),
    findings,
    vendorsHeard: [...reviewedFilesByVendor.keys()],
  };
}

export interface BuildOptions extends Omit<ReviewOptions, "diff"> {
  author: AgentSpec;
  task: string;
  /** Keep the worktree afterwards so you can inspect or merge it. */
  keepWorktree?: boolean;
}

/**
 * The full loop: one agent writes the change, the others review it.
 *
 * The author works in a throwaway worktree, so a session can never modify the
 * checkout you're sitting in. The diff reviewers see is exactly what the
 * author produced there.
 */
export async function buildAndReview(
  options: BuildOptions,
): Promise<SessionReport & { worktreePath?: string }> {
  const { cwd, author, task, events, signal, keepWorktree } = options;

  if (isHttp(author)) {
    throw new Error(
      `"${author.id}" is an HTTP model, which can only read the text it is sent — ` +
        "it cannot edit files, so it cannot be the author. Use a CLI agent " +
        "(claude, codex, gemini, aider, opencode) as --author. HTTP agents make " +
        "excellent reviewers.",
    );
  }

  const stamp = Date.now().toString(36);
  const branch = `crosscheck/${stamp}`;
  const path = join(tmpdir(), `crosscheck-${stamp}`);

  events?.onNote?.(`worktree ${branch}`);
  const worktree = await createWorktree(cwd, path, branch);

  try {
    events?.onStart?.(author, "author");
    const result = await runAgent(author, authorPrompt(task), {
      cwd: worktree.path,
      ...(signal ? { signal } : {}),
      onOutput: (chunk) => events?.onOutput?.(author, chunk),
    });

    const authorRun = toRun(author, "author", result);
    events?.onFinish?.(author, authorRun, 0);

    if (!authorRun.ok) {
      return {
        task,
        diff: "",
        author: authorRun,
        reviews: [],
        findings: [],
        vendorsHeard: [],
        worktreePath: worktree.path,
      };
    }

    // Read the diff from inside the worktree — that's where the work happened.
    const diff = await captureDiff(worktree.path);
    const report = await review({ ...options, cwd: worktree.path, diff });

    return { ...report, author: authorRun, worktreePath: worktree.path };
  } finally {
    if (!keepWorktree) await worktree.remove();
  }
}
