import type { HttpAgentSpec } from "./types.js";

/**
 * Reviewers reachable over HTTP, with no CLI to install and nothing to host.
 *
 * Crosscheck is a command, not a server. It makes a handful of requests during
 * a review and exits, so there is nothing running when you are not using it —
 * no daemon, no gateway, no 24/7 anything. Point it at a provider's endpoint
 * with your own key and you are done.
 *
 * Everything here speaks the OpenAI chat-completions shape, which is why one
 * implementation covers direct provider APIs, hosted routers, and local
 * gateways identically.
 *
 * ON FREE TIERS: several of these are genuinely free and generous. But
 * Crosscheck sends your source code, and a free tier that trains on inputs
 * means your proprietary diff can end up in a training set. Those are marked
 * `trainsOnData` and warned about at run time. Free is the right default for
 * open source; it is the wrong default for your employer's repository.
 */

/**
 * Free-tier limits and data-handling terms change often, and the terms in
 * particular vary by region — in the EEA, Switzerland and the UK, Google
 * applies its paid data terms to free usage too. Treat `trainsOnData` as a
 * prompt to go and check, not as legal advice.
 */
export const FREE_TIER_PROVIDERS: HttpAgentSpec[] = [
  {
    id: "gemini-free",
    name: "Gemini (free tier)",
    vendor: "google",
    kind: "http",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    free: true,
    trainsOnData: true,
    signup: "https://aistudio.google.com/apikey",
  },
  {
    id: "groq-free",
    name: "Groq (free tier)",
    vendor: "meta",
    kind: "http",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
    free: true,
    signup: "https://console.groq.com/keys",
  },
  {
    id: "cerebras-free",
    name: "Cerebras (free tier)",
    vendor: "cerebras",
    kind: "http",
    endpoint: "https://api.cerebras.ai/v1/chat/completions",
    model: "llama-3.3-70b",
    apiKeyEnv: "CEREBRAS_API_KEY",
    free: true,
    signup: "https://cloud.cerebras.ai",
  },
  {
    id: "mistral-free",
    name: "Mistral (Experiment tier)",
    vendor: "mistral",
    kind: "http",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    model: "mistral-large-latest",
    apiKeyEnv: "MISTRAL_API_KEY",
    free: true,
    // The Experiment tier requires opting in to training on your data.
    trainsOnData: true,
    signup: "https://console.mistral.ai",
  },
];

/** Paid endpoints, for when the code you are reviewing is not yours to donate. */
export const PAID_PROVIDERS: HttpAgentSpec[] = [
  {
    id: "anthropic-api",
    name: "Claude (API)",
    vendor: "anthropic",
    kind: "http",
    endpoint: "https://api.anthropic.com/v1/chat/completions",
    model: "claude-sonnet-5",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    signup: "https://console.anthropic.com",
  },
  {
    id: "openai-api",
    name: "OpenAI (API)",
    vendor: "openai",
    kind: "http",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-5",
    apiKeyEnv: "OPENAI_API_KEY",
    signup: "https://platform.openai.com/api-keys",
  },
];

/**
 * Gateways that put many providers behind one key or one port.
 *
 * OpenRouter is hosted, so it needs no infrastructure from you. OmniRoute and
 * Ollama run locally and only need to be up while a review is running — they
 * are not a service you have to keep alive.
 */
export const GATEWAY_PROVIDERS: HttpAgentSpec[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    vendor: "openrouter",
    kind: "http",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "anthropic/claude-sonnet-5",
    apiKeyEnv: "OPENROUTER_API_KEY",
    headers: { "HTTP-Referer": "https://github.com/deliseph/crosscheck", "X-Title": "Crosscheck" },
    signup: "https://openrouter.ai/keys",
  },
  {
    id: "omniroute",
    name: "OmniRoute (local gateway)",
    vendor: "omniroute",
    kind: "http",
    endpoint: "http://localhost:20128/v1/chat/completions",
    model: "claude-sonnet-5",
    apiKeyEnv: "OMNIROUTE_API_KEY",
    signup: "npm install -g omniroute && omniroute",
  },
  {
    id: "ollama",
    name: "Ollama (local models)",
    vendor: "ollama",
    kind: "http",
    endpoint: "http://localhost:11434/v1/chat/completions",
    model: "qwen2.5-coder:14b",
    // Local server, no key.
    signup: "https://ollama.com/download",
  },
];

export const HTTP_PROVIDERS: HttpAgentSpec[] = [
  ...FREE_TIER_PROVIDERS,
  ...PAID_PROVIDERS,
  ...GATEWAY_PROVIDERS,
];

/**
 * Which lab actually made a model, inferred from its identifier.
 *
 * This exists because of a specific way consensus can be silently faked. A
 * gateway may fall back to a different provider when one is rate-limited — if
 * Crosscheck kept labelling that response with the vendor it *asked* for, two
 * "different vendors" agreeing could be the same model twice, and the whole
 * signal would be a lie with no error shown.
 *
 * So the vendor is derived from the model the response says actually served
 * it, never from the one that was requested.
 */
const MODEL_VENDORS: [RegExp, string][] = [
  [/claude|anthropic/i, "anthropic"],
  [/^(openai\/)?(gpt|o[1-9]|chatgpt|codex)/i, "openai"],
  [/gemini|palm|bison/i, "google"],
  [/llama/i, "meta"],
  [/mistral|mixtral|magistral|devstral/i, "mistral"],
  [/deepseek/i, "deepseek"],
  [/qwen/i, "alibaba"],
  [/grok/i, "xai"],
  [/command-?r|cohere/i, "cohere"],
  [/phi-\d/i, "microsoft"],
  [/kimi|moonshot/i, "moonshot"],
  [/glm|zhipu/i, "zhipu"],
];

/** Returns the lab behind a model id, or undefined when it cannot be told. */
export function vendorForModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  for (const [pattern, vendor] of MODEL_VENDORS) {
    if (pattern.test(model)) return vendor;
  }
  return undefined;
}
