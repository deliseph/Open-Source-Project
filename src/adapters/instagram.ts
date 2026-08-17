import type { Adapter, ParseContext } from "../core/adapter.js";
import { result, safely } from "../core/adapter.js";
import type { Source } from "../core/source.js";
import { repairDeep } from "../core/text.js";
import type { Entry, MediaItem, Profile } from "../core/types.js";
import { guessMediaKind, parseTimestamp, stableId } from "../core/util.js";

/**
 * Instagram ("Download Your Information").
 *
 * Instagram has moved these files twice. Older exports put everything under
 * `content/` and `messages/`; since 2023 they live under
 * `your_instagram_activity/`. We look in both places rather than guessing
 * from the export's age.
 *
 * Every string here goes through `repairDeep` because Instagram's JSON is
 * Latin-1-encoded UTF-8 — see src/core/text.ts.
 */

interface IgMedia {
  uri?: string;
  title?: string;
  creation_timestamp?: number;
  media_metadata?: unknown;
}

interface IgPost {
  media?: IgMedia[];
  title?: string;
  creation_timestamp?: number;
}

interface IgMessage {
  sender_name?: string;
  timestamp_ms?: number;
  content?: string;
  photos?: { uri?: string }[];
  videos?: { uri?: string }[];
  share?: { link?: string };
}

interface IgThread {
  participants?: { name?: string }[];
  messages?: IgMessage[];
  title?: string;
  thread_path?: string;
}

/** Both layouts, newest first. */
const POST_FILES = /^(your_instagram_activity\/(media|content)|content)\/posts_\d+\.json$/;
const STORY_FILES = /^(your_instagram_activity\/(media|content)|content)\/stories\.json$/;
const THREAD_FILES = /messages\/inbox\/[^/]+\/message_\d+\.json$/;
const LIKE_FILES = /likes\/liked_posts\.json$/;
const PROFILE_FILES = /personal_information\/personal_information\.json$/;

function toMedia(items: IgMedia[] | undefined): MediaItem[] {
  const out: MediaItem[] = [];
  for (const item of items ?? []) {
    if (!item.uri) continue;
    const taken = parseTimestamp(item.creation_timestamp);
    out.push({
      sourcePath: item.uri,
      kind: guessMediaKind(item.uri),
      ...(item.title ? { caption: item.title } : {}),
      ...(taken ? { takenAt: taken } : {}),
    });
  }
  return out;
}

async function readProfile(source: Source, ctx: ParseContext): Promise<Profile> {
  const profile: Profile = { platform: "instagram" };
  const [path] = await source.find(PROFILE_FILES);
  if (!path) return profile;

  await safely(ctx, path, async () => {
    const data = repairDeep(await source.readJSON<Record<string, unknown>>(path));
    const users = (data as { profile_user?: { string_map_data?: Record<string, { value?: string }> }[] })
      .profile_user;
    const map = users?.[0]?.string_map_data;
    if (map?.["Username"]?.value) profile.handle = map["Username"].value;
    if (map?.["Name"]?.value) profile.displayName = map["Name"].value;
  });
  return profile;
}

async function readPosts(source: Source, ctx: ParseContext, entries: Entry[]): Promise<void> {
  for (const path of await source.find(POST_FILES)) {
    await safely(ctx, path, async () => {
      const posts = repairDeep(await source.readJSON<IgPost[]>(path));
      if (!Array.isArray(posts)) return;

      for (const post of posts) {
        const media = toMedia(post.media);
        // Single-image posts often carry the caption and date on the media
        // item instead of the post, so fall back to the first one.
        const createdAt =
          parseTimestamp(post.creation_timestamp) ??
          parseTimestamp(post.media?.[0]?.creation_timestamp) ??
          media[0]?.takenAt;
        if (!createdAt) continue;

        const text = post.title || post.media?.[0]?.title || undefined;
        entries.push({
          id: stableId("instagram", "post", createdAt.getTime(), media[0]?.sourcePath ?? text),
          platform: "instagram",
          kind: "post",
          createdAt,
          ...(text ? { text } : {}),
          media,
          raw: post,
        });
      }
    });
  }
}

async function readStories(source: Source, ctx: ParseContext, entries: Entry[]): Promise<void> {
  for (const path of await source.find(STORY_FILES)) {
    await safely(ctx, path, async () => {
      const data = repairDeep(await source.readJSON<{ ig_stories?: IgMedia[] }>(path));
      for (const story of data.ig_stories ?? []) {
        const createdAt = parseTimestamp(story.creation_timestamp);
        if (!createdAt || !story.uri) continue;
        entries.push({
          id: stableId("instagram", "story", story.uri),
          platform: "instagram",
          kind: "story",
          createdAt,
          ...(story.title ? { text: story.title } : {}),
          media: toMedia([story]),
          raw: story,
        });
      }
    });
  }
}

async function readMessages(source: Source, ctx: ParseContext, entries: Entry[]): Promise<void> {
  for (const path of await source.find(THREAD_FILES)) {
    await safely(ctx, path, async () => {
      const thread = repairDeep(await source.readJSON<IgThread>(path));
      const participants = (thread.participants ?? [])
        .map((p) => p.name)
        .filter((n): n is string => Boolean(n));
      // The folder name is the only stable thread identifier in the export.
      const conversationId = thread.thread_path ?? path.split("/").slice(-2, -1)[0] ?? path;

      for (const message of thread.messages ?? []) {
        const createdAt = parseTimestamp(message.timestamp_ms);
        if (!createdAt) continue;

        const media = toMedia([
          ...(message.photos ?? []).map((p) => ({ uri: p.uri })),
          ...(message.videos ?? []).map((v) => ({ uri: v.uri })),
        ]);
        // Skip the empty records Instagram emits for unsent messages.
        if (!message.content && media.length === 0) continue;

        entries.push({
          id: stableId("instagram", "dm", conversationId, createdAt.getTime(), message.sender_name),
          platform: "instagram",
          kind: "message",
          createdAt,
          ...(message.content ? { text: message.content } : {}),
          media,
          thread: {
            conversationId,
            ...(message.sender_name ? { from: message.sender_name } : {}),
            participants,
          },
          ...(message.share?.link ? { url: message.share.link } : {}),
          raw: message,
        });
      }
    });
  }
}

async function readLikes(source: Source, ctx: ParseContext, entries: Entry[]): Promise<void> {
  for (const path of await source.find(LIKE_FILES)) {
    await safely(ctx, path, async () => {
      interface Like {
        title?: string;
        string_list_data?: { href?: string; value?: string; timestamp?: number }[];
      }
      const data = repairDeep(await source.readJSON<{ likes_media_likes?: Like[] }>(path));
      for (const like of data.likes_media_likes ?? []) {
        const item = like.string_list_data?.[0];
        const createdAt = parseTimestamp(item?.timestamp);
        if (!createdAt) continue;
        entries.push({
          id: stableId("instagram", "like", item?.href ?? createdAt.getTime()),
          platform: "instagram",
          kind: "like",
          createdAt,
          ...(like.title ? { text: `Liked a post by ${like.title}` } : {}),
          media: [],
          ...(item?.href ? { url: item.href } : {}),
          raw: like,
        });
      }
    });
  }
}

export const instagram: Adapter = {
  id: "instagram",
  name: "Instagram",
  requestUrl: "https://accountscenter.instagram.com/info_and_permissions/dyi/",

  async detect(source) {
    const markers = await source.find(
      /^(your_instagram_activity\/|personal_information\/personal_information\.json|content\/posts_\d+\.json)/,
    );
    if (markers.length === 0) return 0;
    // A posts file is conclusive; the folder alone is merely likely.
    return markers.some((p) => /posts_\d+\.json$/.test(p)) ? 1 : 0.8;
  },

  async parse(source, ctx) {
    const entries: Entry[] = [];
    const profile = await readProfile(source, ctx);

    await readPosts(source, ctx, entries);
    await readStories(source, ctx, entries);
    await readMessages(source, ctx, entries);
    await readLikes(source, ctx, entries);

    if (entries.length === 0) {
      ctx.warn(
        "No posts, stories or messages found. Instagram splits exports into parts — check you selected the full date range and downloaded every part.",
      );
    }
    return result(profile, entries, ctx);
  },
};
