import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAgents } from "../src/core/agents.js";
import { vendorForModel } from "../src/core/providers.js";
import { runAgent } from "../src/core/run.js";
import { review, buildAndReview } from "../src/core/session.js";
import type { HttpAgentSpec } from "../src/core/types.js";
import { isHttp } from "../src/core/types.js";

/**
 * A stand-in OpenAI-compatible endpoint.
 *
 * Running a real server rather than stubbing fetch means the request shape,
 * auth header and JSON handling are all genuinely exercised.
 */
function serve(handler: (body: any) => { status?: number; json: unknown }): Promise<{
  url: string;
  server: Server;
  lastRequest: () => { body: any; auth?: string };
}> {
  let last: { body: any; auth?: string } = { body: null };

  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : null;
        last = { body, ...(req.headers.authorization ? { auth: req.headers.authorization } : {}) };
        const { status = 200, json } = handler(body);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}/v1/chat/completions`, server, lastRequest: () => last });
    });
  });
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

function spec(url: string, over: Partial<HttpAgentSpec> = {}): HttpAgentSpec {
  return {
    id: "test",
    name: "Test",
    vendor: "anthropic",
    kind: "http",
    endpoint: url,
    model: "claude-sonnet-5",
    timeout: 10,
    ...over,
  };
}

const findings = (title: string) =>
  JSON.stringify([{ file: "app.js", line: 2, severity: "major", title }]);

describe("vendorForModel", () => {
  it("identifies the lab behind a model id", () => {
    expect(vendorForModel("claude-sonnet-5")).toBe("anthropic");
    expect(vendorForModel("anthropic/claude-opus-4")).toBe("anthropic");
    expect(vendorForModel("gpt-5")).toBe("openai");
    expect(vendorForModel("gemini-2.5-flash")).toBe("google");
    expect(vendorForModel("llama-3.3-70b-versatile")).toBe("meta");
    expect(vendorForModel("deepseek-chat")).toBe("deepseek");
    expect(vendorForModel("qwen2.5-coder:14b")).toBe("alibaba");
  });

  it("returns undefined rather than guessing", () => {
    expect(vendorForModel("some-unknown-model")).toBeUndefined();
    expect(vendorForModel(undefined)).toBeUndefined();
  });
});

describe("runAgent over HTTP", () => {
  it("sends an OpenAI-shaped request and returns the content", async () => {
    const { url, server, lastRequest } = await serve(() => ({
      json: { model: "claude-sonnet-5", choices: [{ message: { content: findings("bug") } }] },
    }));
    servers.push(server);

    process.env["TEST_KEY"] = "sk-abc";
    const result = await runAgent(spec(url, { apiKeyEnv: "TEST_KEY" }), "review this");
    delete process.env["TEST_KEY"];

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("bug");
    expect(lastRequest().auth).toBe("Bearer sk-abc");
    expect(lastRequest().body.model).toBe("claude-sonnet-5");
    expect(lastRequest().body.messages[0].content).toBe("review this");
    // Review is a judgement task; sampling should not vary the verdict.
    expect(lastRequest().body.temperature).toBe(0);
  });

  it("reports a missing key without making a request", async () => {
    delete process.env["ABSENT_KEY"];
    const result = await runAgent(spec("http://127.0.0.1:1/v1", { apiKeyEnv: "ABSENT_KEY" }), "x");

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("ABSENT_KEY is not set");
  });

  it("surfaces the provider's error message", async () => {
    const { url, server } = await serve(() => ({
      status: 429,
      json: { error: { message: "Rate limit exceeded" } },
    }));
    servers.push(server);

    const result = await runAgent(spec(url), "x");
    expect(result.ok).toBe(false);
    expect(result.stderr).toBe("Rate limit exceeded");
  });

  it("explains a refused connection instead of leaking ECONNREFUSED", async () => {
    const result = await runAgent(
      spec("http://127.0.0.1:1/v1/chat/completions", { signup: "start the gateway" }),
      "x",
    );
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/Nothing is listening|fetch failed/);
  });

  it("treats an empty completion as a failure, not a clean review", async () => {
    const { url, server } = await serve(() => ({
      json: { model: "claude-sonnet-5", choices: [{ message: { content: "" } }] },
    }));
    servers.push(server);

    const result = await runAgent(spec(url), "x");
    expect(result.ok).toBe(false);
  });
});

describe("gateway fallback cannot fake consensus", () => {
  it("labels a reviewer by the model that actually served it", async () => {
    // Asked for Anthropic; the gateway fell back to OpenAI.
    const { url, server } = await serve(() => ({
      json: { model: "gpt-5", choices: [{ message: { content: findings("bug") } }] },
    }));
    servers.push(server);

    const result = await runAgent(spec(url), "x");
    expect(result.servedModel).toBe("gpt-5");
    expect(result.servedVendor).toBe("openai");
  });

  it("does not confirm a finding when both reviewers fell back to one vendor", async () => {
    const make = async (title: string) => {
      const { url, server } = await serve(() => ({
        // Both gateways silently answer with the same lab.
        json: { model: "gpt-5", choices: [{ message: { content: findings(title) } }] },
      }));
      servers.push(server);
      return url;
    };

    const a = await make("off by one in retry loop");
    const b = await make("retry loop runs one extra time");

    const report = await review({
      cwd: process.cwd(),
      diff: "--- a/app.js\n+++ b/app.js\n@@\n+x\n",
      reviewers: [
        spec(a, { id: "r1", vendor: "anthropic" }),
        spec(b, { id: "r2", vendor: "google" }),
      ],
    });

    // Two nominally different vendors, one real one — so no CONFIRMED.
    expect(report.vendorsHeard).toEqual(["openai"]);
    expect(report.findings[0]?.verdict).not.toBe("confirmed");
    expect(report.findings[0]?.agreement).toBe(1);
  });

  it("still confirms when the served vendors genuinely differ", async () => {
    const make = async (model: string, title: string) => {
      const { url, server } = await serve(() => ({
        json: { model, choices: [{ message: { content: findings(title) } }] },
      }));
      servers.push(server);
      return url;
    };

    const a = await make("claude-sonnet-5", "off by one in retry loop");
    const b = await make("gpt-5", "retry loop runs one extra time");

    const report = await review({
      cwd: process.cwd(),
      diff: "--- a/app.js\n+++ b/app.js\n@@\n+x\n",
      reviewers: [spec(a, { id: "r1" }), spec(b, { id: "r2", vendor: "openai" })],
    });

    expect(report.vendorsHeard.sort()).toEqual(["anthropic", "openai"]);
    expect(report.findings[0]?.verdict).toBe("confirmed");
  });
});

describe("HTTP agents cannot author", () => {
  it("refuses with an explanation rather than producing an empty diff", async () => {
    await expect(
      buildAndReview({
        cwd: process.cwd(),
        author: spec("http://127.0.0.1:1/v1"),
        task: "do something",
        reviewers: [],
      }),
    ).rejects.toThrow(/cannot edit files/);
  });
});

describe("provider presets", () => {
  it("are registered and usable by id", () => {
    const agents = resolveAgents(undefined);
    const ids = agents.map((a) => a.id);

    expect(ids).toContain("gemini-free");
    expect(ids).toContain("openrouter");
    expect(ids).toContain("omniroute");
    expect(ids).toContain("ollama");
    // The CLI agents are still there.
    expect(ids).toContain("claude");
  });

  it("flags which free tiers may train on what you send", () => {
    const agents = resolveAgents(undefined).filter(isHttp);
    const gemini = agents.find((a) => a.id === "gemini-free");
    const groq = agents.find((a) => a.id === "groq-free");

    expect(gemini?.trainsOnData).toBe(true);
    expect(groq?.trainsOnData).toBeUndefined();
  });

  it("lets a local gateway be used with no API key", () => {
    const ollama = resolveAgents(undefined).filter(isHttp).find((a) => a.id === "ollama");
    expect(ollama?.apiKeyEnv).toBeUndefined();
  });

  it("accepts a user-defined HTTP agent from config", () => {
    const agents = resolveAgents({
      reviewers: ["mine"],
      agents: [
        {
          id: "mine",
          name: "Mine",
          vendor: "acme",
          kind: "http",
          endpoint: "https://acme.test/v1/chat/completions",
          model: "acme-1",
        },
      ],
    });
    expect(agents.find((a) => a.id === "mine")).toBeDefined();
  });

  it("rejects an incomplete HTTP agent rather than failing at run time", () => {
    const agents = resolveAgents({
      reviewers: [],
      agents: [{ id: "broken", name: "Broken", vendor: "acme", kind: "http" }],
    });
    expect(agents.find((a) => a.id === "broken")).toBeUndefined();
  });
});
