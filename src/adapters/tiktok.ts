import type { Adapter } from "../core/adapter.js";
import { result, safely } from "../core/adapter.js";
import type { Entry, Profile } from "../core/types.js";
import { guessMediaKind, parseTimestamp, stableId } from "../core/util.js";

/**
 * TikTok ("Download your data", JSON format).
 *
 * TikTok offers TXT or JSON; only JSON is machine-readable, so that's what we
 * read. The schema uses Title Case keys with spaces and has been reorganised
 * repeatedly, so every lookup here is defensive — a missing branch means that
 * section wasn't included in the export, not that the file is broken.
 *
 * Videos are referenced by URL, not bundled as files. TikTok's links expire,
 * which we warn about rather than silently producing an archive of dead URLs.
 */

type Json = Record<string, unknown>;

/** Walks a path of Title Case keys, tolerating any missing level. */
function dig(root: unknown, ...keys: string[]): unknown {
  let node: unknown = root;
  for (const key of keys) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Json)[key];
  }
  return node;
}

/** Finds the first present spelling of a key across export versions. */
function digAny(root: unknown, paths: string[][]): unknown {
  for (const path of paths) {
    const found = dig(root, ...path);
    if (found != null) return found;
  }
  return undefined;
}

const DATA_FILES = /^(user_data(_tiktok)?|TikTok_Data.*)\.json$/i;

export const tiktok: Adapter = {
  id: "tiktok",
  name: "TikTok",
  requestUrl: "https://www.tiktok.com/setting/download-your-data",

  async detect(source) {
    const files = await source.find(DATA_FILES);
    if (files.length === 0) return 0;
    // Confirm it's really TikTok's schema and not a coincidental filename.
    for (const path of files) {
      try {
        const data = await source.readJSON<Json>(path);
        if (dig(data, "Video") || dig(data, "Profile") || dig(data, "Activity")) return 1;
      } catch {
        // Fall through to the weaker score below.
      }
    }
    return 0.4;
  },

  async parse(source, ctx) {
    const profile: Profile = { platform: "tiktok" };
    const entries: Entry[] = [];
    let expiringLinks = 0;

    for (const path of await source.find(DATA_FILES)) {
      await safely(ctx, path, async () => {
        const data = await source.readJSON<Json>(path);

        const profileMap = digAny(data, [
          ["Profile", "Profile Information", "ProfileMap"],
          ["Profile", "Profile Info", "ProfileMap"],
        ]) as Json | undefined;
        if (typeof profileMap?.["userName"] === "string") profile.handle = profileMap["userName"];
        if (typeof profileMap?.["nickName"] === "string") {
          profile.displayName = profileMap["nickName"];
        }

        const videos = digAny(data, [
          ["Video", "Videos", "VideoList"],
          ["Post", "Posts", "VideoList"],
        ]) as Json[] | undefined;
        for (const video of videos ?? []) {
          const createdAt = parseTimestamp(video["Date"] ?? video["date"]);
          const link = (video["Link"] ?? video["link"]) as string | undefined;
          if (!createdAt) continue;
          if (link) expiringLinks++;

          entries.push({
            id: stableId("tiktok", "video", link ?? createdAt.getTime()),
            platform: "tiktok",
            kind: "post",
            createdAt,
            ...(typeof video["Title"] === "string" && video["Title"]
              ? { text: video["Title"] }
              : {}),
            media: link ? [{ sourcePath: link, kind: guessMediaKind(link) }] : [],
            ...(typeof video["Likes"] === "string" || typeof video["Likes"] === "number"
              ? { metrics: { likes: Number(video["Likes"]) || 0 } }
              : {}),
            ...(link ? { url: link } : {}),
            raw: video,
          });
        }

        const likes = digAny(data, [
          ["Activity", "Like List", "ItemFavoriteList"],
          ["Your Activity", "Like List", "ItemFavoriteList"],
        ]) as Json[] | undefined;
        for (const like of likes ?? []) {
          const createdAt = parseTimestamp(like["date"] ?? like["Date"]);
          const link = (like["link"] ?? like["Link"]) as string | undefined;
          if (!createdAt) continue;
          entries.push({
            id: stableId("tiktok", "like", link ?? createdAt.getTime()),
            platform: "tiktok",
            kind: "like",
            createdAt,
            text: "Liked a video",
            media: [],
            ...(link ? { url: link } : {}),
            raw: like,
          });
        }

        // Chat history is keyed by "Chat History with <name>:".
        const chats = digAny(data, [
          ["Direct Messages", "Chat History", "ChatHistory"],
          ["Direct Message", "Chat History", "ChatHistory"],
        ]) as Record<string, Json[]> | undefined;
        for (const [heading, messages] of Object.entries(chats ?? {})) {
          const other = heading.replace(/^Chat History with\s*/i, "").replace(/:$/, "").trim();
          for (const message of messages ?? []) {
            const createdAt = parseTimestamp(message["Date"] ?? message["date"]);
            if (!createdAt) continue;
            const content = (message["Content"] ?? message["content"]) as string | undefined;
            const from = (message["From"] ?? message["from"]) as string | undefined;
            entries.push({
              id: stableId("tiktok", "dm", other, createdAt.getTime(), from),
              platform: "tiktok",
              kind: "message",
              createdAt,
              ...(content ? { text: content } : {}),
              media: [],
              thread: { conversationId: other, ...(from ? { from } : {}), participants: [other] },
              raw: message,
            });
          }
        }
      });
    }

    if (expiringLinks > 0) {
      ctx.warn(
        `${expiringLinks} video(s) are stored as TikTok download links rather than files, and those links expire within days. Download them soon if you want to keep the videos themselves.`,
      );
    }
    return result(profile, entries, ctx);
  },
};
