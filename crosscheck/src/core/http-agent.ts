import { vendorForModel } from "./providers.js";
import type { HttpAgentSpec } from "./types.js";

/**
 * Calling a model over an OpenAI-compatible endpoint.
 *
 * Deliberately the plainest possible implementation: one POST, no streaming,
 * no SDK. Every provider, hosted router and local gateway worth using speaks
 * this shape, so this one function reaches all of them.
 */

export interface HttpRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  /**
   * The model the response says actually served the request.
   *
   * Gateways fall back between providers when one is rate-limited, so this can
   * differ from what was asked for — and when it does, the vendor label has to
   * follow it, or cross-vendor consensus silently becomes a lie.
   */
  servedModel?: string;
  /** Vendor derived from `servedModel`, when it could be determined. */
  servedVendor?: string;
}

interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string } | string;
}

function errorText(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null) {
    const error = (body as ChatResponse).error;
    if (typeof error === "string") return error;
    if (error?.message) return error.message;
  }
  return `HTTP ${status}`;
}

export interface HttpRunOptions {
  timeout?: number;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}

export async function runHttpAgent(
  spec: HttpAgentSpec,
  prompt: string,
  options: HttpRunOptions = {},
): Promise<HttpRunResult> {
  const started = Date.now();
  const timeoutMs = (options.timeout ?? spec.timeout ?? 300) * 1000;

  const key = spec.apiKeyEnv ? process.env[spec.apiKeyEnv] : undefined;
  if (spec.apiKeyEnv && !key) {
    return {
      ok: false,
      stdout: "",
      stderr:
        `${spec.apiKeyEnv} is not set.` +
        (spec.signup ? ` Get a key at ${spec.signup}` : ""),
      timedOut: false,
      durationMs: 0,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  options.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const response = await fetch(spec.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...spec.headers,
      },
      body: JSON.stringify({
        model: spec.model,
        messages: [{ role: "user", content: prompt }],
        // Reviewing is a judgement task, not a creative one.
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    let body: ChatResponse;
    try {
      body = JSON.parse(raw) as ChatResponse;
    } catch {
      return {
        ok: false,
        stdout: "",
        stderr: `Response was not JSON: ${raw.slice(0, 200)}`,
        timedOut: false,
        durationMs: Date.now() - started,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        stdout: "",
        stderr: errorText(body, response.status),
        timedOut: false,
        durationMs: Date.now() - started,
      };
    }

    const content = body.choices?.[0]?.message?.content ?? "";
    options.onOutput?.(content);

    const servedModel = body.model ?? spec.model;
    const servedVendor = vendorForModel(servedModel);

    return {
      ok: content.trim().length > 0,
      stdout: content,
      stderr: content.trim() ? "" : "Model returned an empty response.",
      timedOut: false,
      durationMs: Date.now() - started,
      ...(servedModel ? { servedModel } : {}),
      ...(servedVendor ? { servedVendor } : {}),
    };
  } catch (error) {
    const aborted = (error as Error).name === "AbortError";
    const message = (error as NodeJS.ErrnoException).code === "ECONNREFUSED"
      ? `Nothing is listening at ${spec.endpoint}.` +
        (spec.signup ? ` Start it with: ${spec.signup}` : "")
      : (error as Error).message;

    return {
      ok: false,
      stdout: "",
      stderr: aborted ? "timed out" : message,
      timedOut: aborted,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Whether an HTTP agent is usable: key present, or none needed. */
export function isConfigured(spec: HttpAgentSpec): boolean {
  return !spec.apiKeyEnv || Boolean(process.env[spec.apiKeyEnv]);
}
