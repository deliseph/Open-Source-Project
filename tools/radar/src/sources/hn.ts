import { getJson } from "./http.js";
import type { Hit } from "../types.js";

/**
 * Hacker News, via the public Algolia search API.
 *
 * Documented at https://hn.algolia.com/api — no key, no auth, generous limits.
 * `search_by_date` is used rather than `search` because relevance ranking will
 * happily hand you a thread from 2013 that nobody will ever read again.
 */

interface AlgoliaHit {
  objectID: string;
  title?: string;
  story_title?: string;
  comment_text?: string;
  story_text?: string;
  url?: string;
  author?: string;
  created_at: string;
  points?: number;
  num_comments?: number;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
}

/** Strips the HTML that Algolia returns inside comment bodies. */
export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    // Ampersand last, so the entities above aren't double-decoded.
    .replace(/&amp;/g, "&")
    .trim();
}

export function toHits(response: AlgoliaResponse): Hit[] {
  const hits: Hit[] = [];

  for (const hit of response.hits ?? []) {
    const title = hit.title ?? hit.story_title;
    if (!title) continue;

    const created = new Date(hit.created_at);
    if (Number.isNaN(created.getTime())) continue;

    const body = hit.comment_text ?? hit.story_text;

    hits.push({
      id: `hn-${hit.objectID}`,
      source: "hn",
      title: stripHtml(title),
      ...(body ? { text: stripHtml(body) } : {}),
      // Always link to the HN thread, not the submitted URL — the discussion is
      // the thing you would be replying to.
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      ...(hit.author ? { author: hit.author } : {}),
      createdAt: created,
      ...(hit.points != null ? { points: hit.points } : {}),
      ...(hit.num_comments != null ? { comments: hit.num_comments } : {}),
    });
  }
  return hits;
}

export async function search(term: string, sinceDays: number): Promise<Hit[]> {
  const since = Math.floor((Date.now() - sinceDays * 86_400_000) / 1000);
  const url =
    `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(term)}` +
    `&tags=(story,comment)&numericFilters=created_at_i>${since}&hitsPerPage=30`;

  return toHits(await getJson<AlgoliaResponse>(url));
}
