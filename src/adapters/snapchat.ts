import type { Adapter } from "../core/adapter.js";
import { result, safely } from "../core/adapter.js";
import type { Entry, Profile } from "../core/types.js";
import { parseTimestamp, stableId } from "../core/util.js";

/**
 * Snapchat ("My Data").
 *
 * Two things make Snapchat exports unusual, and both are worth knowing before
 * you rely on one:
 *
 *  1. Memories are delivered as expiring download links in
 *     `memories_history.json`, not as files in the ZIP. Nothing here can
 *     recover them once the links lapse.
 *  2. Snaps that were never saved to Memories are not in the export at all.
 *     They were deleted from Snapchat's servers when they expired, which is
 *     the product working as designed — not an export bug.
 */

type Json = Record<string, unknown>;

interface SnapMemory {
  Date?: string;
  "Media Type"?: string;
  "Download Link"?: string;
}

interface SnapMessage {
  From?: string;
  "Media Type"?: string;
  Created?: string;
  Content?: string;
  "Conversation Title"?: string | null;
  IsSender?: boolean;
}

const MEMORIES = /(^|\/)memories_history\.json$/;
const CHATS = /(^|\/)chat_history\.json$/;
const ACCOUNT = /(^|\/)account\.json$/;

export const snapchat: Adapter = {
  id: "snapchat",
  name: "Snapchat",
  requestUrl: "https://accounts.snapchat.com/accounts/downloadmydata",

  async detect(source) {
    const markers = await source.find(/(^|\/)(memories_history|chat_history|snap_history)\.json$/);
    if (markers.length > 0) return 1;
    return (await source.find(ACCOUNT)).length > 0 && (await source.find(/^json\//)).length > 0
      ? 0.7
      : 0;
  },

  async parse(source, ctx) {
    const profile: Profile = { platform: "snapchat" };
    const entries: Entry[] = [];

    for (const path of await source.find(ACCOUNT)) {
      await safely(ctx, path, async () => {
        const data = await source.readJSON<Json>(path);
        const basic = data["Basic Information"] as Json | undefined;
        const username = basic?.["Username"];
        const name = basic?.["Name"] ?? basic?.["Display Name"];
        if (typeof username === "string") profile.handle = username;
        if (typeof name === "string") profile.displayName = name;
      });
    }

    let linkOnly = 0;
    for (const path of await source.find(MEMORIES)) {
      await safely(ctx, path, async () => {
        const data = await source.readJSON<Record<string, SnapMemory[]>>(path);
        // The key has been "Saved Media" and "Memories" across versions.
        const items = data["Saved Media"] ?? data["Memories"] ?? [];
        for (const memory of items) {
          const createdAt = parseTimestamp(memory.Date);
          if (!createdAt) continue;
          const link = memory["Download Link"];
          if (link) linkOnly++;

          const declared = (memory["Media Type"] ?? "").toLowerCase();
          const kind =
            declared.includes("video") ? "video" : declared.includes("image") ? "image" : "unknown";

          entries.push({
            id: stableId("snapchat", "memory", link ?? createdAt.getTime()),
            platform: "snapchat",
            kind: "memory",
            createdAt,
            media: link ? [{ sourcePath: link, kind }] : [],
            ...(link ? { url: link } : {}),
            raw: memory,
          });
        }
      });
    }

    for (const path of await source.find(CHATS)) {
      await safely(ctx, path, async () => {
        // Keyed by the other person's username, each holding their messages.
        const data = await source.readJSON<Record<string, SnapMessage[]>>(path);
        for (const [conversation, messages] of Object.entries(data)) {
          if (!Array.isArray(messages)) continue;
          for (const message of messages) {
            const createdAt = parseTimestamp(message.Created);
            if (!createdAt) continue;
            const text =
              message.Content ||
              (message["Media Type"] && message["Media Type"] !== "TEXT"
                ? `[${message["Media Type"].toLowerCase()}]`
                : undefined);

            entries.push({
              id: stableId("snapchat", "chat", conversation, createdAt.getTime(), message.From),
              platform: "snapchat",
              kind: "message",
              createdAt,
              ...(text ? { text } : {}),
              media: [],
              thread: {
                conversationId: message["Conversation Title"] || conversation,
                ...(message.From ? { from: message.From } : {}),
                participants: [conversation],
              },
              raw: message,
            });
          }
        }
      });
    }

    if (linkOnly > 0) {
      ctx.warn(
        `${linkOnly} memory item(s) are download links, not files — Snapchat does not put your photos in the ZIP, and the links expire roughly a week after the export is generated.`,
      );
    }
    if (entries.length === 0) {
      ctx.warn(
        "Nothing found. Snapchat's export only covers saved Memories and chats; snaps that expired were deleted and cannot be exported.",
      );
    }
    return result(profile, entries, ctx);
  },
};
