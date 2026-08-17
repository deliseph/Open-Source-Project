import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * The small amount of git Crosscheck needs.
 *
 * Diffs can be large, so the buffer is raised well above Node's 1MB default —
 * a truncated diff would silently give reviewers an incomplete picture, which
 * is worse than failing.
 */
const MAX_BUFFER = 64 * 1024 * 1024;

/** Git's fixed hash for the empty tree, used when a repo has no commits yet. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: MAX_BUFFER });
  return stdout;
}

export async function isRepo(cwd: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--git-dir"], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function currentBranch(cwd: string): Promise<string> {
  return (await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();
}

/**
 * The diff to review.
 *
 * With no `base`, this is the working tree against HEAD including untracked
 * files — the "what have I got right now" case. With a `base`, it's the
 * three-dot diff against the merge base, matching what a PR would show.
 */
export async function captureDiff(cwd: string, base?: string): Promise<string> {
  if (base) return git(["diff", `${base}...HEAD`], cwd);

  // A repo with no commits has no HEAD to diff against. Fall back to the
  // canonical empty tree so staged files in a fresh repo still show up.
  const hasHead = await git(["rev-parse", "--verify", "HEAD"], cwd).then(
    () => true,
    () => false,
  );
  const against = hasHead ? "HEAD" : EMPTY_TREE;

  const tracked = await git(["diff", against], cwd);
  const untracked = (await git(["ls-files", "--others", "--exclude-standard"], cwd))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let extra = "";
  for (const file of untracked) {
    try {
      // --no-index diffs a new file against nothing, and exits 1 by design.
      extra += await git(["diff", "--no-index", "--", "/dev/null", file], cwd);
    } catch (error) {
      const stdout = (error as { stdout?: string }).stdout;
      if (stdout) extra += stdout;
    }
  }
  return tracked + extra;
}

/** Files touched by a diff, parsed from its `+++ b/…` headers. */
export function filesInDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const match = /^\+\+\+ b\/(.+)$/.exec(line);
    if (match?.[1] && match[1] !== "dev/null") files.add(match[1]);
  }
  return [...files];
}

/**
 * Rough token estimate, used to warn before handing a reviewer a diff that
 * won't fit in its context. Deliberately crude — four characters per token is
 * close enough to catch the cases that matter.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface Worktree {
  path: string;
  branch: string;
  remove(): Promise<void>;
}

/**
 * Creates a throwaway worktree so an author agent can't touch your checkout.
 *
 * The agent gets a real, complete clone of the repo at a new branch; you keep
 * working in yours. Removal is forced because agents leave build artefacts.
 */
export async function createWorktree(
  cwd: string,
  path: string,
  branch: string,
): Promise<Worktree> {
  await git(["worktree", "add", "-b", branch, path], cwd);
  return {
    path,
    branch,
    async remove() {
      try {
        await git(["worktree", "remove", "--force", path], cwd);
      } catch {
        // Already gone, or never fully created — nothing useful to do.
      }
    },
  };
}
