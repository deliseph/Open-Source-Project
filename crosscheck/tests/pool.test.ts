import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAgents } from "../src/core/agents.js";
import { Cooldowns, mixedVendorSlots, resolveSlots, runSlot, vendorsIn } from "../src/core/pool.js";
import { review } from "../src/core/session.js";
import type { HttpAgentSpec } from "../src/core/types.js";

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** An endpoint that answers, or refuses with a given status. */
function endpoint(opts: { status?: number; model?: string; title?: string }): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const status = opts.status ?? 200;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            status === 200
              ? {
                  model: opts.model ?? "claude-sonnet-5",
                  choices: [
                    {
                      message: {
                        content: JSON.stringify([
                          {
                            file: "app.js",
                            line: 2,
                            severity: "major",
                            title: opts.title ?? "off by one in retry loop",
                          },
                        ]),
                      },
                    },
                  ],
                }
              : { error: { message: "quota exhausted" } },
          ),
        );
      });
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve(`http://127.0.0.1:${port}/v1/chat/completions`);
    });
  });
}

function spec(id: string, url: string, vendor = "anthropic", model = "claude-sonnet-5"): HttpAgentSpec {
  return { id, name: id, vendor, kind: "http", endpoint: url, model, timeout: 10 };
}

const DIFF = "--- a/app.js\n+++ b/app.js\n@@\n+x\n";

describe("resolveSlots", () => {
  it("treats | as a fallback chain within one seat", () => {
    const agents = resolveAgents(undefined);
    const { slots } = resolveSlots(["gemini-free|groq-free", "anthropic-api"], agents);

    expect(slots).toHaveLength(2);
    expect(slots[0]!.candidates.map((c) => c.id)).toEqual(["gemini-free", "groq-free"]);
    expect(slots[1]!.candidates).toHaveLength(1);
  });

  it("takes the seat's vendor from its first candidate", () => {
    const { slots } = resolveSlots(["gemini-free|groq-free"], resolveAgents(undefined));
    expect(slots[0]!.vendor).toBe("google");
  });

  it("reports unknown ids rather than silently dropping them", () => {
    const { slots, unknown } = resolveSlots(["claude|nope"], resolveAgents(undefined));
    expect(unknown).toEqual(["nope"]);
    expect(slots[0]!.candidates.map((c) => c.id)).toEqual(["claude"]);
  });
});

describe("vendor diversity guard", () => {
  it("flags a seat whose fallbacks cross vendors", () => {
    const { slots } = resolveSlots(["gemini-free|groq-free", "anthropic-api"], resolveAgents(undefined));
    const mixed = mixedVendorSlots(slots);

    expect(mixed).toHaveLength(1);
    expect(vendorsIn(mixed[0]!)).toEqual(new Set(["google", "meta"]));
  });

  it("does not flag a same-vendor chain", () => {
    const { slots } = resolveSlots(["gemini-free|gemini-free"], resolveAgents(undefined));
    expect(mixedVendorSlots(slots)).toEqual([]);
  });
});

describe("runSlot", () => {
  it("falls through to the next candidate when quota is exhausted", async () => {
    const dead = await endpoint({ status: 429 });
    const alive = await endpoint({});

    const result = await runSlot({
      id: "seat",
      vendor: "anthropic",
      candidates: [spec("first", dead), spec("second", alive)],
    }, "review");

    expect(result.used?.id).toBe("second");
    expect(result.attempts.map((a) => a.agent)).toEqual(["first", "second"]);
    expect(result.attempts[0]!.rateLimited).toBe(true);
  });

  it("stops on a non-quota failure instead of burning every key", async () => {
    const broken = await endpoint({ status: 500 });
    const alive = await endpoint({});

    const result = await runSlot({
      id: "seat",
      vendor: "anthropic",
      candidates: [spec("first", broken), spec("second", alive)],
    }, "review");

    expect(result.used).toBeUndefined();
    // The healthy second candidate was never called.
    expect(result.attempts).toHaveLength(1);
  });

  it("skips an endpoint that is still cooling down", async () => {
    const alive = await endpoint({});
    const cooldowns = new Cooldowns(join(await mkdtemp(join(tmpdir(), "cc-")), "c.json"));
    await cooldowns.load();
    cooldowns.start("first", 600);

    const result = await runSlot(
      { id: "seat", vendor: "anthropic", candidates: [spec("first", alive), spec("second", alive)] },
      "review",
      { cooldowns },
    );

    expect(result.used?.id).toBe("second");
    expect(result.attempts[0]!.reason).toMatch(/cooling down/);
  });

  it("records a cooldown when a provider reports quota exhaustion", async () => {
    const dead = await endpoint({ status: 429 });
    const cooldowns = new Cooldowns(join(await mkdtemp(join(tmpdir(), "cc-")), "c.json"));
    await cooldowns.load();

    await runSlot({ id: "s", vendor: "v", candidates: [spec("only", dead)] }, "review", { cooldowns });

    expect(cooldowns.isCooling("only")).toBe(true);
    expect(cooldowns.remaining("only")).toBeGreaterThan(0);
  });
});

describe("failover cannot inflate consensus", () => {
  it("keeps agreement at 1 when both seats fall back to the same lab", async () => {
    const deadA = await endpoint({ status: 429 });
    const deadB = await endpoint({ status: 429 });
    // Both fallbacks are served by the same lab.
    const sharedA = await endpoint({ model: "gpt-5", title: "off by one in retry loop" });
    const sharedB = await endpoint({ model: "gpt-5", title: "retry loop runs one extra time" });

    const report = await review({
      cwd: process.cwd(),
      reviewers: [],
      diff: DIFF,
      slots: [
        { id: "a", vendor: "anthropic", candidates: [spec("a1", deadA), spec("a2", sharedA, "openai", "gpt-5")] },
        { id: "b", vendor: "google", candidates: [spec("b1", deadB), spec("b2", sharedB, "openai", "gpt-5")] },
      ],
    });

    expect(report.vendorsHeard).toEqual(["openai"]);
    expect(report.findings[0]?.verdict).not.toBe("confirmed");
    expect(report.findings[0]?.agreement).toBe(1);
  });

  it("still confirms when fallbacks preserve two distinct labs", async () => {
    const dead = await endpoint({ status: 429 });
    const anthropic = await endpoint({ model: "claude-sonnet-5", title: "off by one in retry loop" });
    const openai = await endpoint({ model: "gpt-5", title: "retry loop runs one extra time" });

    const report = await review({
      cwd: process.cwd(),
      reviewers: [],
      diff: DIFF,
      slots: [
        { id: "a", vendor: "anthropic", candidates: [spec("a1", dead), spec("a2", anthropic)] },
        { id: "b", vendor: "openai", candidates: [spec("b1", openai, "openai", "gpt-5")] },
      ],
    });

    expect(report.vendorsHeard.sort()).toEqual(["anthropic", "openai"]);
    expect(report.findings[0]?.verdict).toBe("confirmed");
  });

  it("reports which seats needed a fallback", async () => {
    const dead = await endpoint({ status: 429 });
    const alive = await endpoint({});

    const report = await review({
      cwd: process.cwd(),
      reviewers: [],
      diff: DIFF,
      slots: [{ id: "a", vendor: "anthropic", candidates: [spec("a1", dead), spec("a2", alive)] }],
    });

    expect(report.fellBack).toEqual(["a1 -> a2"]);
  });
});
