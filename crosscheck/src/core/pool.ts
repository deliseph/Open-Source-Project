import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { findAgent } from "./agents.js";
import { runAgent, type RunOptions, type RunResult } from "./run.js";
import type { AgentSpec } from "./types.js";

/**
 * Keeping a review alive when a free tier runs out.
 *
 * Free quotas are the point of failure: a reviewer that worked this morning
 * returns 429 this afternoon and the run dies. A slot is one reviewer *seat*
 * with an ordered list of endpoints that can fill it, tried until one answers.
 *
 * The rule that matters: **a slot exists to hold a vendor, not to get an
 * answer.** Falling back from Anthropic to whatever happens to be working
 * could leave every seat served by the same lab — Crosscheck would show three
 * reviewers while the vendor diversity that makes CONFIRMED mean anything had
 * quietly collapsed. So fallbacks within a slot should be the same vendor
 * reached another way, and a slot that can only be filled by a lab already
 * covered elsewhere is dropped rather than double-counted.
 *
 * There is deliberately nothing here that acquires credentials. Endpoints come
 * from your config, and keys from your environment. Harvesting keys or farming
 * free-tier accounts is theft and quota fraud respectively, and would get the
 * people using this banned.
 */

export interface Slot {
  /** Display id — the first candidate's id. */
  id: string;
  /** The vendor this seat is meant to represent. */
  vendor: string;
  /** Tried in order until one answers. */
  candidates: AgentSpec[];
}

export interface Attempt {
  agent: string;
  ok: boolean;
  reason?: string;
  rateLimited?: boolean;
}

export interface SlotResult {
  slot: Slot;
  /** The candidate that answered, if any. */
  used?: AgentSpec;
  result?: RunResult;
  attempts: Attempt[];
}

/**
 * Remembers which endpoints are out of quota, so a run doesn't waste time
 * re-asking an endpoint that told us to come back tomorrow.
 */
export class Cooldowns {
  #path: string;
  #until: Record<string, number> = {};

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<void> {
    try {
      this.#until = JSON.parse(await readFile(this.#path, "utf8")) as Record<string, number>;
    } catch {
      this.#until = {};
    }
  }

  isCooling(id: string): boolean {
    const until = this.#until[id];
    return until != null && until > Date.now();
  }

  /** Default to an hour when the provider didn't say how long to wait. */
  start(id: string, seconds = 3600): void {
    this.#until[id] = Date.now() + Math.min(seconds, 86_400) * 1000;
  }

  remaining(id: string): number {
    const until = this.#until[id];
    return until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
  }

  async save(): Promise<void> {
    // Drop entries that have expired rather than growing the file forever.
    const now = Date.now();
    for (const [id, until] of Object.entries(this.#until)) {
      if (until <= now) delete this.#until[id];
    }
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, JSON.stringify(this.#until, null, 2), "utf8");
  }
}

export const COOLDOWN_PATH = join(".crosscheck", "cooldowns.json");

/**
 * Turns reviewer ids into slots.
 *
 * A `|` chains fallbacks within one seat: `gemini-free|gemini-api` is one
 * Google seat that tries the free tier first. Separate reviewers stay separate
 * seats, as before.
 */
export function resolveSlots(ids: string[], agents: AgentSpec[]): { slots: Slot[]; unknown: string[] } {
  const slots: Slot[] = [];
  const unknown: string[] = [];

  for (const entry of ids) {
    const candidates: AgentSpec[] = [];
    for (const id of entry.split("|").map((s) => s.trim()).filter(Boolean)) {
      const spec = findAgent(agents, id);
      if (spec) candidates.push(spec);
      else unknown.push(id);
    }
    if (candidates.length === 0) continue;

    const first = candidates[0]!;
    slots.push({ id: first.id, vendor: first.vendor, candidates });
  }
  return { slots, unknown };
}

/** Vendors a fallback chain might legitimately produce. */
export function vendorsIn(slot: Slot): Set<string> {
  return new Set(slot.candidates.map((c) => c.vendor));
}

/**
 * Warns when a chain can silently change which lab fills a seat.
 *
 * Mixing vendors in one chain is allowed — sometimes any second opinion beats
 * none — but it means a CONFIRMED verdict may rest on a different pair of labs
 * than you configured, so it should never happen without you knowing.
 */
export function mixedVendorSlots(slots: Slot[]): Slot[] {
  return slots.filter((s) => vendorsIn(s).size > 1);
}

export interface RunSlotOptions extends RunOptions {
  cooldowns?: Cooldowns;
  /** Called when a candidate is skipped or fails over. */
  onFallback?: (from: AgentSpec, to: AgentSpec | undefined, reason: string) => void;
}

/**
 * Runs one seat, falling through its candidates until something answers.
 *
 * Only quota failures move on to the next candidate. A malformed request or a
 * server error is reported as-is, because retrying it elsewhere usually just
 * produces the same failure more slowly.
 */
export async function runSlot(
  slot: Slot,
  prompt: string,
  options: RunSlotOptions = {},
): Promise<SlotResult> {
  const { cooldowns, onFallback, ...runOptions } = options;
  const attempts: Attempt[] = [];

  for (let i = 0; i < slot.candidates.length; i++) {
    const candidate = slot.candidates[i]!;
    const next = slot.candidates[i + 1];

    if (cooldowns?.isCooling(candidate.id)) {
      const wait = cooldowns.remaining(candidate.id);
      attempts.push({ agent: candidate.id, ok: false, reason: `cooling down ${wait}s`, rateLimited: true });
      onFallback?.(candidate, next, `out of quota for another ${wait}s`);
      continue;
    }

    const result = await runAgent(candidate, prompt, runOptions);
    if (result.ok) {
      attempts.push({ agent: candidate.id, ok: true });
      return { slot, used: candidate, result, attempts };
    }

    const reason = result.stderr.trim() || "failed";
    attempts.push({
      agent: candidate.id,
      ok: false,
      reason,
      ...(result.rateLimited ? { rateLimited: true } : {}),
    });

    if (result.rateLimited) {
      cooldowns?.start(candidate.id, result.retryAfter);
      onFallback?.(candidate, next, "out of quota");
      continue;
    }

    // Not a quota problem — stop rather than burning every key on it.
    return { slot, attempts };
  }

  return { slot, attempts };
}
