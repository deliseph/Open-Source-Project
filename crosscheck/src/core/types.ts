/**
 * The shared vocabulary. Everything in Crosscheck is one of these.
 */

/** How to invoke one CLI coding agent without a human at the keyboard. */
export interface AgentSpec {
  /** Short, stable, lowercase — used in config and output. */
  id: string;
  /** Shown in the office view, e.g. "Claude Code". */
  name: string;
  /**
   * Who makes it. Consensus deliberately only counts agreement *across*
   * vendors, since two agents from the same lab share blind spots.
   */
  vendor: string;
  /** Executable to run. Must be on PATH. */
  command: string;
  /**
   * Arguments. The literal token `{{prompt}}` is replaced with the prompt;
   * if no token is present the prompt is written to stdin instead.
   */
  args: string[];
  /** Seconds before the agent is considered stuck. */
  timeout?: number;
  /** A one-line note shown when the agent isn't installed. */
  install?: string;
}

export type Severity = "critical" | "major" | "minor" | "nit";

/** One thing a reviewer claims is wrong. */
export interface Finding {
  /** Which agent said it. */
  agent: string;
  vendor: string;
  file: string;
  /** 1-indexed. Absent when the reviewer didn't say. */
  line?: number;
  severity: Severity;
  /** Short label, e.g. "off-by-one in retry loop". */
  title: string;
  /** The reasoning. */
  detail?: string;
}

/**
 * A finding after cross-vendor comparison.
 *
 * `agreement` is the number of distinct *vendors* that raised it, which is the
 * number that actually matters — see `consensus.ts`.
 */
export interface ConsensusFinding extends Finding {
  agreement: number;
  /** Every agent that raised this, including the one in `agent`. */
  raisedBy: string[];
  /** Set when another reviewer looked at this and said it was fine. */
  disputedBy?: string[];
}

export type Verdict = "confirmed" | "single" | "disputed";

export interface RankedFinding extends ConsensusFinding {
  verdict: Verdict;
}

/** What one agent did when asked to do something. */
export interface AgentRun {
  agent: string;
  vendor: string;
  role: "author" | "reviewer";
  ok: boolean;
  /** Raw stdout, kept so a user can always see what the agent actually said. */
  output: string;
  error?: string;
  durationMs: number;
}

export interface SessionReport {
  task: string;
  /** Unified diff the reviewers were shown. */
  diff: string;
  author?: AgentRun;
  reviews: AgentRun[];
  findings: RankedFinding[];
  /** Distinct vendors that produced a usable review. */
  vendorsHeard: string[];
}

/** A team, as loaded from crosscheck.json. */
export interface TeamConfig {
  /** Agent id that writes the code. Optional — you can review your own diff. */
  author?: string;
  /** Agent ids that review it. */
  reviewers: string[];
  /** Extra or overriding agent specs, merged over the built-ins by id. */
  agents?: Partial<AgentSpec>[];
}
