import { HTTP_PROVIDERS } from "./providers.js";
import type { AgentSpec, CommandAgentSpec, TeamConfig } from "./types.js";

/**
 * Built-in agent specs.
 *
 * These are declarative on purpose: adding an agent is a config entry, not a
 * code change, so nobody has to wait for a release to use a new CLI.
 *
 * CLI flags drift. Every field here can be overridden per-project in
 * `crosscheck.json`, and `crosscheck doctor` shows the exact command that
 * will run, so a broken default is a one-line fix rather than a blocker.
 */
export const BUILTIN_AGENTS: AgentSpec[] = [
  {
    id: "claude",
    name: "Claude Code",
    vendor: "anthropic",
    command: "claude",
    args: ["-p", "{{prompt}}"],
    timeout: 900,
    install: "npm install -g @anthropic-ai/claude-code",
  },
  {
    id: "codex",
    name: "Codex CLI",
    vendor: "openai",
    command: "codex",
    args: ["exec", "{{prompt}}"],
    timeout: 900,
    install: "npm install -g @openai/codex",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    vendor: "google",
    command: "gemini",
    args: ["-p", "{{prompt}}"],
    timeout: 900,
    install: "npm install -g @google/gemini-cli",
  },
  {
    id: "aider",
    name: "Aider",
    vendor: "aider",
    command: "aider",
    args: ["--message", "{{prompt}}", "--yes", "--no-auto-commits"],
    timeout: 900,
    install: "pip install aider-install && aider-install",
  },
  {
    id: "opencode",
    name: "OpenCode",
    vendor: "opencode",
    command: "opencode",
    args: ["run", "{{prompt}}"],
    timeout: 900,
    install: "npm install -g opencode-ai",
  },
];

export const PROMPT_TOKEN = "{{prompt}}";

/** Merges user overrides over the built-ins, matching on `id`. */
export function resolveAgents(config: TeamConfig | undefined): AgentSpec[] {
  const byId = new Map<string, AgentSpec>();
  for (const spec of BUILTIN_AGENTS) byId.set(spec.id, { ...spec });
  // HTTP providers need no install, so they are always available to configure.
  for (const spec of HTTP_PROVIDERS) byId.set(spec.id, { ...spec });

  for (const override of config?.agents ?? []) {
    if (!override.id) continue;
    const existing = byId.get(override.id);
    if (existing) {
      byId.set(override.id, { ...existing, ...override } as AgentSpec);
      continue;
    }
    // A brand-new agent needs enough to actually run — which differs by kind.
    if (!override.name || !override.vendor) continue;
    const complete =
      override.kind === "http"
        ? Boolean(override.endpoint && override.model)
        : Boolean(override.command && override.args);
    if (complete) byId.set(override.id, override as AgentSpec);
  }
  return [...byId.values()];
}

export function findAgent(agents: AgentSpec[], id: string): AgentSpec | undefined {
  return agents.find((a) => a.id === id);
}

/**
 * Builds the argv for a run.
 *
 * When no `{{prompt}}` token appears the prompt goes to stdin instead, which
 * is how several agents prefer to receive long input — and avoids blowing the
 * OS argument-length limit on a big diff.
 */
export function buildInvocation(
  spec: CommandAgentSpec,
  prompt: string,
): { args: string[]; useStdin: boolean } {
  const useStdin = !spec.args.includes(PROMPT_TOKEN);
  return {
    args: useStdin ? [...spec.args] : spec.args.map((a) => (a === PROMPT_TOKEN ? prompt : a)),
    useStdin,
  };
}
