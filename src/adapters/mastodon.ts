import type { Adapter } from "../core/adapter.js";
import { result, safely } from "../core/adapter.js";
import type { Entry, MediaItem, Profile } from "../core/types.js";
import { guessMediaKind, parseTimestamp } from "../core/util.js";

/**
 * Mastodon, and anything else that exports an ActivityPub outbox.
 *
 * This is the export format the others should be measured against: an open
 * standard, media bundled as real files, and stable ids. Because it's a
 * standard rather than a vendor format, this adapter also handles exports
 * from other ActivityPub servers (Pleroma, Akkoma, GoToSocial).
 *
 * Post bodies are HTML, so we keep the original in `raw` and store a
 * plain-text rendering in `text`.
 */

interface ApAttachment {
  url?: string;
  mediaType?: string;
  name?: string;
}

interface ApObject {
  id?: string;
  type?: string;
  content?: string;
  published?: string;
  url?: string;
  attachment?: ApAttachment[];
}

interface ApActivity {
  type?: string;
  published?: string;
  object?: ApObject | string;
}

/** Turns Mastodon's post HTML into readable plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Ampersand last, so the entities above aren't double-decoded.
    .replace(/&amp;/g, "&")
    .trim();
}

export const mastodon: Adapter = {
  id: "mastodon",
  name: "Mastodon (ActivityPub)",
  requestUrl: "https://<your-instance>/settings/export",

  async detect(source) {
    const hasOutbox = await source.exists("outbox.json");
    if (!hasOutbox) return 0;
    return (await source.exists("actor.json")) ? 1 : 0.8;
  },

  async parse(source, ctx) {
    const profile: Profile = { platform: "mastodon" };
    const entries: Entry[] = [];

    if (await source.exists("actor.json")) {
      await safely(ctx, "actor.json", async () => {
        const actor = await source.readJSON<{ preferredUsername?: string; name?: string }>(
          "actor.json",
        );
        if (actor.preferredUsername) profile.handle = actor.preferredUsername;
        if (actor.name) profile.displayName = actor.name;
      });
    }

    await safely(ctx, "outbox.json", async () => {
      const outbox = await source.readJSON<{ orderedItems?: ApActivity[] }>("outbox.json");
      for (const activity of outbox.orderedItems ?? []) {
        // Announce activities are boosts; the object is just a URL string.
        if (typeof activity.object === "string" || !activity.object) continue;
        const object = activity.object;
        const createdAt = parseTimestamp(object.published ?? activity.published);
        if (!createdAt) continue;

        const media: MediaItem[] = (object.attachment ?? [])
          .filter((a): a is ApAttachment & { url: string } => Boolean(a.url))
          .map((a) => {
            // Attachment URLs are relative to the export root.
            const path = a.url.replace(/^\//, "");
            const declared = a.mediaType?.split("/")[0];
            const kind =
              declared === "image" || declared === "video" || declared === "audio"
                ? declared
                : guessMediaKind(path);
            return {
              sourcePath: path,
              kind,
              ...(a.name ? { caption: a.name } : {}),
            };
          });

        const text = object.content ? htmlToText(object.content) : undefined;

        entries.push({
          id: object.id ?? `mastodon-${createdAt.getTime()}`,
          platform: "mastodon",
          kind: "post",
          createdAt,
          ...(text ? { text } : {}),
          media,
          ...(object.url ?? object.id ? { url: object.url ?? object.id } : {}),
          raw: activity,
        });
      }
    });

    return result(profile, entries, ctx);
  },
};
