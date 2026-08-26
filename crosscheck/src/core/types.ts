/**
 * The shared vocabulary. Everything in Crosscheck is one of these.
 */

/** Fields every agent has, however it is reached. */
export interface AgentSpecBase {
  /** Short, stable, lowercase — used in config and output. */
  id: string;
  /** Shown in the office view, e.g. "Claude Code". */
  name: string;
  /**
   * Who makes it. Consensus deliberately only counts agreement *across*
   * vendors, since two agents from the same lab share blind spots.
   */
  vendor: string;
  /** Seconds before the agent is considered stuck. */
  timeout?: number;
}

/** A coding agent invoked as a subprocess, without a human at the keyboard. */
export interface CommandAgentSpec extends AgentSpecBase {
  kind?: "command";
  /** Executable to run. Must be on PATH. */
  command: string;
  /**
   * Arguments. The literal token `{{prompt}}` is replaced with the prompt;
   * if no token is present the prompt is written to stdin instead.
   */
  args: string[];
  /** A one-line note shown when the agent isn't installed. */
  install?: string;
}

/**
 * A model reached over an OpenAI-compatible HTTP endpoint.
 *
 * This is what lets Crosscheck work without installing a CLI per vendor.
 * Because the shape is the de-facto standard, one implementation covers
 * provider APIs directly, hosted routers, and local gateways alike.
 *
 * Note the asymmetry with {@link CommandAgentSpec}: a CLI agent can read the
 * repository and run tests, while an HTTP model only ever sees the text it is
 * sent. That is fine for reviewing a diff — the diff *is* the input — but an
 * HTTP agent cannot be the author, because it cannot edit files.
 */
export interface HttpAgentSpec extends AgentSpecBase {
  kind: "http";
  /** Full chat-completions URL. */
  endpoint: string;
  /** Model identifier to request. */
  model: string;
  /** Environment variable holding the API key. Omit for keyless local servers. */
  apiKeyEnv?: string;
  /** Extra headers, e.g. attribution headers some routers ask for. */
  headers?: Record<string, string>;
  /** Whether this endpoint has a usable free tier. */
  free?: boolean;
  /**
   * Whether the provider may train on what you send on its free tier.
   *
   * Crosscheck sends your source code, so this is not a footnote — it is
   * surfaced by `doctor` and warned about before a run.
   */
  trainsOnData?: boolean;
  /** Where to get a key. */
  signup?: string;
}

export type AgentSpec = CommandAgentSpec | HttpAgentSpec;

/** A partial spec as it appears in crosscheck.json, before validation. */
export type AgentOverride = Partial<CommandAgentSpec> & Partial<HttpAgentSpec>;

export function isHttp(spec: AgentSpec): spec is HttpAgentSpec {
  return spec.kind === "http";
}

export function isCommand(spec: AgentSpec): spec is CommandAgentSpec {
  return spec.kind !== "http";
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
  /**
   * Extra or overriding agent specs, merged over the built-ins by id.
   *
   * Both kinds' fields are permitted here because config is JSON — validation
   * happens in `resolveAgents`, which checks each kind has what it needs.
   */
  agents?: AgentOverride[];
}
