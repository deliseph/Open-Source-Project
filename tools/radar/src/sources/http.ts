/**
 * The only way this tool touches the network.
 *
 * There is deliberately no `method` parameter and no request body. Radar reads;
 * it cannot post, vote, or edit anything, and that is enforced by construction
 * rather than by convention. `tests/no-write.test.ts` fails the build if a
 * mutating verb appears anywhere in the source.
 */

const USER_AGENT =
  "archivore-radar/0.1 (read-only mention monitor; +https://github.com/deliseph/archivore)";

/** Be a good citizen: one request at a time, with a gap between them. */
const MIN_GAP_MS = 1100;
let lastRequest = 0;

async function pace(): Promise<void> {
  const wait = lastRequest + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
  }
}

/**
 * Fetches JSON over GET, retrying once on a rate limit.
 *
 * Retries are deliberately unaggressive — being throttled means you are asking
 * too often, and hammering through it is how a User-Agent gets blocked.
 */
export async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await pace();

    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json", ...headers },
      redirect: "follow",
    });

    if (response.ok) return (await response.json()) as T;

    if (response.status === 429 && attempt === 0) {
      const retryAfter = Number(response.headers.get("retry-after") ?? 5);
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000));
      continue;
    }
    throw new HttpError(response.status, url);
  }
  throw new HttpError(429, url);
}
