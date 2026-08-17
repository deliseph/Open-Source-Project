import { getJson } from "./http.js";
import type { Hit } from "../types.js";

/**
 * Reddit, via the public JSON endpoints.
 *
 * Appending `.json` to any Reddit URL returns the same data the site renders,
 * with no auth. Reddit is strict about User-Agent and rate limiting — the
 * shared client sends a descriptive one and paces requests, and you should not
 * lower that gap. A blocked User-Agent is not worth the saved seconds.
 */

interface RedditChild {
  kind: string;
  data: {
    id: string;
    title?: string;
    selftext?: string;
    body?: string;
    permalink?: string;
    author?: string;
    subreddit?: string;
    created_utc?: number;
    score?: number;
    num_comments?: number;
    over_18?: boolean;
  };
}

interface RedditListing {
  data?: { children?: RedditChild[] };
}

export function toHits(listing: RedditListing): Hit[] {
  const hits: Hit[] = [];

  for (const child of listing.data?.children ?? []) {
    const d = child.data;
    if (!d?.id || !d.permalink) continue;
    // Never surface NSFW threads as somewhere to go promote a tool.
    if (d.over_18) continue;

    const title = d.title ?? d.body?.slice(0, 120);
    if (!title) continue;

    const created = new Date((d.created_utc ?? 0) * 1000);
    if (Number.isNaN(created.getTime()) || created.getTime() === 0) continue;

    const body = d.selftext || d.body;

    hits.push({
      id: `reddit-${d.id}`,
      source: "reddit",
      title,
      ...(body ? { text: body } : {}),
      url: `https://www.reddit.com${d.permalink}`,
      ...(d.author ? { author: d.author } : {}),
      createdAt: created,
      ...(d.subreddit ? { context: `r/${d.subreddit}` } : {}),
      ...(d.score != null ? { points: d.score } : {}),
      ...(d.num_comments != null ? { comments: d.num_comments } : {}),
    });
  }
  return hits;
}

/**
 * Searches Reddit, optionally scoped to specific subreddits.
 *
 * Scoping matters: the same question asked in r/DataHoarder is an invitation
 * and in an unrelated subreddit is an intrusion.
 */
export async function search(
  term: string,
  subreddits: string[] | undefined,
  sinceDays: number,
): Promise<Hit[]> {
  const scoped = subreddits?.length
    ? `${term} (${subreddits.map((s) => `subreddit:${s}`).join(" OR ")})`
    : term;

  // Reddit's search only offers coarse time buckets; filter precisely after.
  const window = sinceDays <= 7 ? "week" : sinceDays <= 31 ? "month" : sinceDays <= 365 ? "year" : "all";
  const url =
    `https://www.reddit.com/search.json?q=${encodeURIComponent(scoped)}` +
    `&sort=relevance&t=${window}&limit=40`;

  const hits = toHits(await getJson<RedditListing>(url));
  const cutoff = Date.now() - sinceDays * 86_400_000;
  return hits.filter((h) => h.createdAt.getTime() >= cutoff);
}
