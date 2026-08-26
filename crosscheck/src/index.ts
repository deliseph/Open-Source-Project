/**
 * Crosscheck's programmatic API.
 *
 * The consensus layer is useful on its own: if you already have findings from
 * several models, `rank` will reconcile them without any of the process
 * machinery.
 */

export type {
  AgentRun,
  AgentSpec,
  ConsensusFinding,
  Finding,
  RankedFinding,
  SessionReport,
  Severity,
  TeamConfig,
  Verdict,
} from "./core/types.js";

export { BUILTIN_AGENTS, buildInvocation, findAgent, resolveAgents } from "./core/agents.js";
export { extractJsonCandidates, normaliseSeverity, parseFindings } from "./core/findings.js";
export { isSameIssue, merge, rank, similarity, tokenise } from "./core/consensus.js";
export { isInstalled, runAgent } from "./core/run.js";
export type { RunOptions, RunResult } from "./core/run.js";
export { captureDiff, createWorktree, estimateTokens, filesInDiff, isRepo } from "./core/git.js";
export { authorPrompt, fixPrompt, reviewPrompt } from "./core/prompts.js";
export { buildAndReview, review } from "./core/session.js";
export type { BuildOptions, ReviewOptions, SessionEvents } from "./core/session.js";
export { Office, printReport } from "./ui/office.js";
export { renderReport, writeReport } from "./export/report.js";
