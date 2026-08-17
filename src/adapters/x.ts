import type { Adapter } from "../core/adapter.js";
import { result, safely } from "../core/adapter.js";
import type { Source } from "../core/source.js";
import type { Entry, MediaItem, Profile } from "../core/types.js";
import { guessMediaKind, parseTimestamp } from "../core/util.js";

/**
 * X / Twitter ("Download an archive of your data").
 *
 * The archive stores data as JavaScript, not JSON: each file opens with
 * `window.YTD.tweets.part0 = [` so it can be loaded by the bundled HTML
 * viewer via a <script> tag. Stripping the assignment gives back plain JSON.
 */

interface XTweet {
  id_str?: string;
  created_at?: string;
  full_text?: string;
  text?: string;
  favorite_count?: string | number;
  retweet_count?: string | number;
  entities?: { media?: { media_url_https?: string; type?: string; id_str?: string }[] };
  extended_entities?: { media?: { media_url_https?: string; type?: string; id_str?: string }[] };
}

/** Removes the `window.YTD.<name>.part0 = ` prefix ahead of the JSON payload. */
export function stripJsAssignment(text: string): string {
  const match = /^\s*window\.YTD\.[\w.]+\s*=\s*/.exec(text);
  if (match) return text.slice(match[0].length);
  // Some older archives use a bare assignment; fall back to the first bracket.
  const bracket = text.indexOf("[");
  return bracket > 0 && text.slice(0, bracket).includes("=") ? text.slice(bracket) : text;
}

async function readJs<T>(source: Source, path: string): Promise<T> {
  return JSON.parse(stripJsAssignment(await source.readText(path))) as T;
}

/**
 * Matches downloaded media to a tweet.
 *
 * Files in `data/tweets_media/` are named `<tweet id>-<hash>.<ext>`, which is
 * the only link back to the tweet — the JSON references the original CDN URL.
 */
function indexMediaByTweet(paths: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const path of paths) {
    const name = path.split("/").pop() ?? "";
    const id = name.split("-")[0];
    if (!id || !/^\d+$/.test(id)) continue;
    const existing = index.get(id);
    if (existing) existing.push(path);
    else index.set(id, [path]);
  }
  return index;
}

function toNumber(value: string | number | undefined): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export const x: Adapter = {
  id: "x",
  name: "X (Twitter)",
  requestUrl: "https://x.com/settings/download_your_data",

  async detect(source) {
    if (await source.exists("data/tweets.js")) return 1;
    if (await source.exists("data/account.js")) return 0.8;
    return (await source.find(/^data\/tweets-part\d+\.js$/)).length > 0 ? 1 : 0;
  },

  async parse(source, ctx) {
    const profile: Profile = { platform: "x" };
    const entries: Entry[] = [];

    if (await source.exists("data/account.js")) {
      await safely(ctx, "data/account.js", async () => {
        const accounts =
          await readJs<{ account?: { username?: string; accountDisplayName?: string } }[]>(
            source,
            "data/account.js",
          );
        const account = accounts[0]?.account;
        if (account?.username) profile.handle = account.username;
        if (account?.accountDisplayName) profile.displayName = account.accountDisplayName;
      });
    }

    const mediaIndex = indexMediaByTweet(await source.find(/^data\/tweets_media\//));

    // Large accounts get tweets split across numbered parts.
    const tweetFiles = [
      ...(await source.exists("data/tweets.js") ? ["data/tweets.js"] : []),
      ...(await source.find(/^data\/tweets-part\d+\.js$/)),
    ];

    for (const path of tweetFiles) {
      await safely(ctx, path, async () => {
        const records = await readJs<{ tweet?: XTweet }[]>(source, path);
        for (const record of records) {
          const tweet = record.tweet ?? (record as XTweet);
          const createdAt = parseTimestamp(tweet.created_at);
          if (!createdAt || !tweet.id_str) continue;

          const media: MediaItem[] = (mediaIndex.get(tweet.id_str) ?? []).map((p) => ({
            sourcePath: p,
            kind: guessMediaKind(p),
          }));

          const likes = toNumber(tweet.favorite_count);
          const reposts = toNumber(tweet.retweet_count);

          entries.push({
            id: `x-${tweet.id_str}`,
            platform: "x",
            kind: "post",
            createdAt,
            ...(tweet.full_text || tweet.text ? { text: tweet.full_text ?? tweet.text } : {}),
            media,
            ...(likes != null || reposts != null
              ? { metrics: { ...(likes != null ? { likes } : {}), ...(reposts != null ? { reposts } : {}) } }
              : {}),
            ...(profile.handle
              ? { url: `https://x.com/${profile.handle}/status/${tweet.id_str}` }
              : {}),
            raw: tweet,
          });
        }
      });
    }

    if (mediaIndex.size === 0 && entries.length > 0) {
      ctx.warn(
        "No media files found. X only includes images and video if you asked for the full archive rather than the account-data-only download.",
      );
    }
    return result(profile, entries, ctx);
  },
};
