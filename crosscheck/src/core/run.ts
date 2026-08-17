import { spawn } from "node:child_process";

import { buildInvocation } from "./agents.js";
import type { AgentSpec } from "./types.js";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  durationMs: number;
}

export interface RunOptions {
  cwd?: string;
  /** Overrides the spec's timeout. Seconds. */
  timeout?: number;
  /** Streamed as the agent produces output, for the live office view. */
  onOutput?: (chunk: string) => void;
  signal?: AbortSignal;
}

/**
 * Runs a CLI agent to completion and collects what it said.
 *
 * Agents are long-running and chatty, so output is streamed to the caller as
 * it arrives rather than only at the end — otherwise the office view would sit
 * frozen for ten minutes.
 */
export function runAgent(
  spec: AgentSpec,
  prompt: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const { args, useStdin } = buildInvocation(spec, prompt);
  const timeoutMs = (options.timeout ?? spec.timeout ?? 900) * 1000;
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn(spec.command, args, {
      cwd: options.cwd ?? process.cwd(),
      // Agents check for a TTY to decide whether to go interactive; pipes keep
      // them in non-interactive mode, which is what we need.
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CROSSCHECK: "1" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const finish = (result: Omit<RunResult, "durationMs">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ ...result, durationMs: Date.now() - started });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Give it a moment to exit cleanly before insisting.
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMs);

    const onAbort = (): void => {
      child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      options.onOutput?.(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      const hint =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? `${spec.command} is not installed or not on PATH.` +
            (spec.install ? ` Install it with: ${spec.install}` : "")
          : error.message;
      finish({ ok: false, stdout, stderr: hint, code: null, timedOut });
    });

    child.on("close", (code) => {
      finish({
        // A non-zero exit with usable output still counts: several agents exit
        // non-zero after a successful run for unrelated reasons.
        ok: !timedOut && (code === 0 || stdout.trim().length > 0),
        stdout,
        stderr,
        code,
        timedOut,
      });
    });

    if (useStdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

/** Whether an agent's executable can be found, without running a real task. */
export async function isInstalled(spec: AgentSpec): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn(process.platform === "win32" ? "where" : "which", [spec.command], {
      stdio: "ignore",
    });
    probe.on("error", () => resolve(false));
    probe.on("close", (code) => resolve(code === 0));
  });
}
