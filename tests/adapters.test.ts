import { describe, expect, it } from "vitest";

import { WarningCollector } from "../src/core/adapter.js";
import { detect } from "../src/core/registry.js";
import { DirectorySource } from "../src/core/source.js";
import { instagram } from "../src/adapters/instagram.js";
import { mastodon, htmlToText } from "../src/adapters/mastodon.js";
import { snapchat } from "../src/adapters/snapchat.js";
import { tiktok } from "../src/adapters/tiktok.js";
import { stripJsAssignment, x } from "../src/adapters/x.js";

import {
  instagramExport,
  mastodonExport,
  snapchatExport,
  tiktokExport,
  xExport,
} from "./fixtures.js";

async function run(adapter: typeof instagram, root: string) {
  const source = new DirectorySource(root);
  const result = await adapter.parse(source, new WarningCollector(adapter.id));
  return { source, result };
}

describe("detection", () => {
  const cases: [string, () => Promise<string>, string][] = [
    ["Instagram", instagramExport, "instagram"],
    ["X", xExport, "x"],
    ["TikTok", tiktokExport, "tiktok"],
    ["Snapchat", snapchatExport, "snapchat"],
    ["Mastodon", mastodonExport, "mastodon"],
  ];

  for (const [name, make, expectedId] of cases) {
    it(`identifies ${name} without being told`, async () => {
      const source = new DirectorySource(await make());
      const found = await detect(source);
      expect(found[0]?.adapter.id).toBe(expectedId);
    });
  }

  it("returns nothing for a folder that isn't an export", async () => {
    const source = new DirectorySource(await tiktokExport());
    // Detection is content-based, so an unrelated adapter must score zero.
    const scores = await detect(source);
    expect(scores.find((s) => s.adapter.id === "instagram")).toBeUndefined();
  });
});

describe("instagram", () => {
  it("reads posts, stories, messages and likes", async () => {
    const { result } = await run(instagram, await instagramExport());
    const kinds = result.entries.map((e) => e.kind);

    expect(kinds.filter((k) => k === "post")).toHaveLength(2);
    expect(kinds.filter((k) => k === "story")).toHaveLength(1);
    expect(kinds.filter((k) => k === "like")).toHaveLength(1);
    // The third message has no content and no media, so it is dropped.
    expect(kinds.filter((k) => k === "message")).toHaveLength(2);
  });

  it("repairs mangled captions and profile names", async () => {
    const { result } = await run(instagram, await instagramExport());
    const captions = result.entries.map((e) => e.text);

    expect(captions).toContain("café 😀");
    expect(result.profile.handle).toBe("ada");
    expect(result.profile.displayName).toBe("Ada Lövelace");
  });

  it("falls back to the media item when the post has no caption or date", async () => {
    const { result } = await run(instagram, await instagramExport());
    const entry = result.entries.find((e) => e.text === "caption on the media item");
    expect(entry).toBeDefined();
    expect(entry?.createdAt.toISOString().slice(0, 10)).toBe("2024-02-01");
  });

  it("keeps thread participants on messages", async () => {
    const { result } = await run(instagram, await instagramExport());
    const message = result.entries.find((e) => e.kind === "message");
    expect(message?.thread?.participants).toEqual(["Ada", "Grace"]);
  });

  it("sorts newest first", async () => {
    const { result } = await run(instagram, await instagramExport());
    const times = result.entries.map((e) => e.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe("x", () => {
  it("strips the window.YTD assignment", () => {
    expect(stripJsAssignment('window.YTD.tweets.part0 = [{"a":1}]')).toBe('[{"a":1}]');
    expect(stripJsAssignment('[{"a":1}]')).toBe('[{"a":1}]');
  });

  it("reads tweets with metrics and profile", async () => {
    const { result } = await run(x, await xExport());
    expect(result.profile.handle).toBe("ada");
    expect(result.entries).toHaveLength(2);

    const tweet = result.entries.find((e) => e.id === "x-1750000000000000001");
    expect(tweet?.metrics).toEqual({ likes: 128, reposts: 42 });
    expect(tweet?.url).toBe("https://x.com/ada/status/1750000000000000001");
  });

  it("matches downloaded media to its tweet by filename", async () => {
    const { result } = await run(x, await xExport());
    const withMedia = result.entries.find((e) => e.id === "x-1750000000000000002");
    expect(withMedia?.media[0]?.sourcePath).toBe(
      "data/tweets_media/1750000000000000002-abcdef.jpg",
    );
    expect(result.entries.find((e) => e.id === "x-1750000000000000001")?.media).toHaveLength(0);
  });
});

describe("tiktok", () => {
  it("reads videos, likes and chats out of the nested schema", async () => {
    const { result } = await run(tiktok, await tiktokExport());
    expect(result.profile.handle).toBe("ada");

    const kinds = result.entries.map((e) => e.kind);
    expect(kinds).toContain("post");
    expect(kinds).toContain("like");
    expect(kinds).toContain("message");
  });

  it("warns that video links expire", async () => {
    const { result } = await run(tiktok, await tiktokExport());
    expect(result.warnings.some((w) => /expire/i.test(w.message))).toBe(true);
  });
});

describe("snapchat", () => {
  it("reads memories and chats", async () => {
    const { result } = await run(snapchat, await snapchatExport());
    expect(result.profile.handle).toBe("ada");
    expect(result.entries.filter((e) => e.kind === "memory")).toHaveLength(1);
    expect(result.entries.filter((e) => e.kind === "message")).toHaveLength(2);
  });

  it("labels non-text messages by their media type", async () => {
    const { result } = await run(snapchat, await snapchatExport());
    expect(result.entries.map((e) => e.text)).toContain("[image]");
  });

  it("warns that memories are expiring links rather than files", async () => {
    const { result } = await run(snapchat, await snapchatExport());
    expect(result.warnings.some((w) => /link/i.test(w.message))).toBe(true);
  });
});

describe("mastodon", () => {
  it("converts post HTML to readable text", () => {
    expect(htmlToText("<p>one</p><p>two</p>")).toBe("one\n\ntwo");
    expect(htmlToText("a<br>b")).toBe("a\nb");
    // Ampersand decoding must not double-decode the other entities.
    expect(htmlToText("<p>&lt;b&gt; &amp;amp;</p>")).toBe("<b> &amp;");
  });

  it("reads the outbox and skips boosts", async () => {
    const { result } = await run(mastodon, await mastodonExport());
    expect(result.profile.handle).toBe("ada");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.text).toBe("first post\n\nsecond & last paragraph");
  });

  it("resolves attachment paths relative to the export root", async () => {
    const { result } = await run(mastodon, await mastodonExport());
    expect(result.entries[0]?.media[0]).toMatchObject({
      sourcePath: "media_attachments/files/1/original/pic.png",
      kind: "image",
    });
  });
});
