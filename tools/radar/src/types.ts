/**
 * Radar finds conversations. It never joins them.
 *
 * There is no posting code anywhere in this tool and no credential that could
 * write anywhere — see the `no-write` test, which fails the build if any
 * mutating HTTP verb or posting endpoint appears in the source. Everything it
 * produces is a draft for a human to read, edit, and send under their own name.
 */

export type SourceId = "hn" | "reddit" | "lobsters";

/** Something someone already said, somewhere public. */
export interface Hit {
  /** Stable per source, used to remember what you've already seen. */
  id: string;
  source: SourceId;
  title: string;
  /** Body text where the source provides it. */
  text?: string;
  url: string;
  author?: string;
  createdAt: Date;
  /** Subreddit, HN story, etc. */
  context?: string;
  points?: number;
  comments?: number;
}

/**
 * Why Radar surfaced a hit, and what you might say.
 *
 * `draft` is a starting point, never a script. Pasting it verbatim is the
 * fastest way to get read as a bot and filtered.
 */
export interface Lead {
  hit: Hit;
  /** Which query matched — the reason this is relevant to you. */
  topic: string;
  /** Rough 0–1 confidence that replying here is genuinely welcome. */
  relevance: number;
  draft: string;
}

export interface Query {
  /** Short label shown in the digest. */
  topic: string;
  /** What to search for. */
  terms: string[];
  /** Restrict to these subreddits, when searching Reddit. */
  subreddits?: string[];
  /**
   * A reply is only useful if it answers the question actually asked, so each
   * topic carries its own draft rather than one generic pitch.
   */
  draft: string;
  /** Hits older than this are usually not worth replying to. */
  maxAgeDays?: number;
}

export interface RepoStats {
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  /** Distinct people who have landed a commit, excluding the owner. */
  outsideContributors: number;
  contributors: string[];
}
