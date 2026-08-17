import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { captureDiff, filesInDiff, isRepo } from "../src/core/git.js";
import { runAgent } from "../src/core/run.js";
import { review } from "../src/core/session.js";
import type { AgentSpec } from "../src/core/types.js";

const exec = promisify(execFile);

/**
 * Fake agents, so the orchestration is tested without needing Claude Code,
 * Codex and Gemini installed on the machine running the suite.
 *
 * Each is a real subprocess reading a real prompt, so the spawn, streaming,
 * parsing and consensus paths are all genuinely exercised.
 */
async function fakeAgent(
  id: string,
  vendor: string,
  behaviour: string,
): Promise<AgentSpec> {
  const dir = await mkdtemp(join(tmpdir(), "crosscheck-agent-"));
  const script = join(dir, `${id}.mjs`);
  await writeFile(script, behaviour, "utf8");

  return {
    id,
    name: id,
    vendor,
    command: process.execPath,
    args: [script, "{{prompt}}"],
    timeout: 30,
  };
}

/** Prints findings as JSON wrapped in the chatter a real agent produces. */
function respondsWith(findings: unknown): string {
  return `console.log("Here is my review of the diff:");
console.log(${JSON.stringify(JSON.stringify(findings))});
console.log("Hope that helps!");`;
}

async function repoWithChanges(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "crosscheck-repo-"));
  const git = (...args: string[]) => exec("git", args, { cwd: dir });

  await git("init", "-q");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");

  await writeFile(join(dir, "app.js"), "function retry() { return 1; }\n", "utf8");
  await git("add", ".");
  await git("commit", "-qm", "initial");

  // The change under review.
  await writeFile(join(dir, "app.js"), "function retry(n) { for (let i = 0; i <= n; i++) {} }\n", "utf8");
  return dir;
}

describe("runAgent", () => {
  it("captures stdout and streams it as it arrives", async () => {
    const spec = await fakeAgent("echoer", "test", `console.log("hello " + process.argv[2]);`);
    const chunks: string[] = [];

    const result = await runAgent(spec, "world", { onOutput: (c) => chunks.push(c) });

    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("hello world");
    expect(chunks.join("")).toContain("hello world");
  });

  it("passes the prompt on stdin when the spec has no {{prompt}} token", async () => {
    const spec = await fakeAgent(
      "stdin-reader",
      "test",
      `let input = ""; process.stdin.on("data", d => input += d);
       process.stdin.on("end", () => console.log("got:" + input.trim()));`,
    );
    spec.args = [spec.args[0]!]; // drop the {{prompt}} token

    const result = await runAgent(spec, "review this");
    expect(result.stdout.trim()).toBe("got:review this");
  });

  it("reports a missing executable with an install hint", async () => {
    const result = await runAgent(
      {
        id: "ghost",
        name: "Ghost",
        vendor: "none",
        command: "definitely-not-a-real-binary-xyz",
        args: [],
        install: "npm i -g ghost",
      },
      "hi",
    );

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("not installed");
    expect(result.stderr).toContain("npm i -g ghost");
  });

  it("kills an agent that overruns its timeout", async () => {
    const spec = await fakeAgent("sleeper", "test", `setTimeout(() => {}, 60000);`);
    spec.timeout = 1;

    const result = await runAgent(spec, "hi");
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
  }, 15000);
});

describe("git helpers", () => {
  it("captures the working-tree diff and the files it touches", async () => {
    const dir = await repoWithChanges();

    expect(await isRepo(dir)).toBe(true);
    const diff = await captureDiff(dir);

    expect(diff).toContain("app.js");
    expect(filesInDiff(diff)).toEqual(["app.js"]);
  });

  it("includes untracked files, which are usually the new code", async () => {
    const dir = await repoWithChanges();
    await writeFile(join(dir, "brand-new.js"), "export const x = 1;\n", "utf8");

    expect(filesInDiff(await captureDiff(dir))).toContain("brand-new.js");
  });
});

describe("review", () => {
  it("confirms a finding two vendors independently raise", async () => {
    const dir = await repoWithChanges();

    const reviewers = [
      await fakeAgent(
        "claude",
        "anthropic",
        respondsWith([
          { file: "app.js", line: 1, severity: "major", title: "off by one in retry loop" },
        ]),
      ),
      await fakeAgent(
        "codex",
        "openai",
        respondsWith([
          { file: "app.js", line: 1, severity: "critical", title: "retry loop runs one extra time" },
        ]),
      ),
    ];

    const report = await review({ cwd: dir, reviewers });

    expect(report.vendorsHeard.sort()).toEqual(["anthropic", "openai"]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      verdict: "confirmed",
      agreement: 2,
      severity: "critical", // the more alarming of the two ratings wins
    });
  }, 20000);

  it("does not confirm when both reviewers are the same vendor", async () => {
    const dir = await repoWithChanges();
    const body = respondsWith([{ file: "app.js", line: 1, title: "off by one in retry loop" }]);

    const report = await review({
      cwd: dir,
      reviewers: [
        await fakeAgent("claude", "anthropic", body),
        await fakeAgent("claude-b", "anthropic", body),
      ],
    });

    expect(report.findings[0]?.verdict).toBe("single");
    expect(report.findings[0]?.agreement).toBe(1);
  }, 20000);

  it("treats a clean review as success and an unparseable one as failure", async () => {
    const dir = await repoWithChanges();

    const report = await review({
      cwd: dir,
      reviewers: [
        await fakeAgent("clean", "anthropic", respondsWith([])),
        await fakeAgent("rambler", "openai", `console.log("Looks fine to me, no notes.");`),
      ],
    });

    expect(report.findings).toEqual([]);
    expect(report.vendorsHeard).toEqual(["anthropic"]);

    const rambler = report.reviews.find((r) => r.agent === "rambler");
    expect(rambler?.ok).toBe(false);
    expect(rambler?.error).toContain("no parseable findings");
  }, 20000);

  it("carries on when one reviewer is not installed", async () => {
    const dir = await repoWithChanges();

    const report = await review({
      cwd: dir,
      reviewers: [
        await fakeAgent(
          "claude",
          "anthropic",
          respondsWith([{ file: "app.js", title: "off by one in retry loop" }]),
        ),
        { id: "ghost", name: "Ghost", vendor: "none", command: "not-a-real-binary-xyz", args: [] },
      ],
    });

    expect(report.findings).toHaveLength(1);
    expect(report.reviews.find((r) => r.agent === "ghost")?.ok).toBe(false);
  }, 20000);

  it("returns immediately when there is nothing to review", async () => {
    const dir = await mkdtemp(join(tmpdir(), "crosscheck-empty-"));
    await exec("git", ["init", "-q"], { cwd: dir });

    const report = await review({ cwd: dir, reviewers: [] });
    expect(report.findings).toEqual([]);
    expect(report.diff).toBe("");
  });
});
