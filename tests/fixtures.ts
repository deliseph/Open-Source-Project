import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Builders for miniature exports that mirror the real file layouts.
 *
 * These are hand-written from the shapes the platforms actually ship rather
 * than captured from anyone's account, so there is no personal data in the
 * repository and the fixtures can be freely edited.
 */

export async function tempDir(prefix = "archivore-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function put(root: string, path: string, body: string): Promise<void> {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, body, "utf8");
}

/** An Instagram export, complete with the Latin-1 mangling of real ones. */
export async function instagramExport(): Promise<string> {
  const root = await tempDir();

  await put(
    root,
    "personal_information/personal_information.json",
    JSON.stringify({
      profile_user: [
        { string_map_data: { Username: { value: "ada" }, Name: { value: "Ada L\\u00c3\\u00b6velace" } } },
      ],
    }).replace(/\\\\u/g, "\\u"),
  );

  // Note the escaped mojibake in the caption: "cafÃ© ð".
  await put(
    root,
    "your_instagram_activity/media/posts_1.json",
    `[
      {
        "media": [
          { "uri": "media/posts/202401/photo1.jpg", "creation_timestamp": 1704067200, "title": "" }
        ],
        "title": "caf\\u00c3\\u00a9 \\u00f0\\u009f\\u0098\\u0080",
        "creation_timestamp": 1704067200
      },
      {
        "media": [
          {
            "uri": "media/posts/202402/photo2.jpg",
            "creation_timestamp": 1706745600,
            "title": "caption on the media item"
          }
        ]
      }
    ]`,
  );

  await put(
    root,
    "your_instagram_activity/media/stories.json",
    JSON.stringify({
      ig_stories: [
        { uri: "media/stories/story1.jpg", creation_timestamp: 1704153600, title: "a story" },
      ],
    }),
  );

  await put(
    root,
    "your_instagram_activity/messages/inbox/grace_h_1234/message_1.json",
    JSON.stringify({
      participants: [{ name: "Ada" }, { name: "Grace" }],
      title: "Grace",
      thread_path: "inbox/grace_h_1234",
      messages: [
        { sender_name: "Grace", timestamp_ms: 1704240000000, content: "did it compile" },
        { sender_name: "Ada", timestamp_ms: 1704240060000, content: "eventually" },
        { sender_name: "Ada", timestamp_ms: 1704240120000 },
      ],
    }),
  );

  await put(
    root,
    "your_instagram_activity/likes/liked_posts.json",
    JSON.stringify({
      likes_media_likes: [
        {
          title: "charles_b",
          string_list_data: [
            { href: "https://www.instagram.com/p/abc123/", value: "👍", timestamp: 1704326400 },
          ],
        },
      ],
    }),
  );

  for (const path of [
    "media/posts/202401/photo1.jpg",
    "media/posts/202402/photo2.jpg",
    "media/stories/story1.jpg",
  ]) {
    await put(root, path, "not-a-real-jpeg");
  }

  return root;
}

/** An X archive, with the `window.YTD` JavaScript wrapper the real one uses. */
export async function xExport(): Promise<string> {
  const root = await tempDir();

  await put(
    root,
    "data/account.js",
    `window.YTD.account.part0 = ${JSON.stringify([
      { account: { username: "ada", accountDisplayName: "Ada Lovelace" } },
    ])}`,
  );

  await put(
    root,
    "data/tweets.js",
    `window.YTD.tweets.part0 = ${JSON.stringify([
      {
        tweet: {
          id_str: "1750000000000000001",
          created_at: "Wed Jan 03 12:00:00 +0000 2024",
          full_text: "the analytical engine has no pretensions whatever to originate anything",
          favorite_count: "128",
          retweet_count: "42",
        },
      },
      {
        tweet: {
          id_str: "1750000000000000002",
          created_at: "Thu Jan 04 09:30:00 +0000 2024",
          full_text: "with photo",
          favorite_count: "3",
          retweet_count: "0",
        },
      },
    ])}`,
  );

  await put(root, "data/tweets_media/1750000000000000002-abcdef.jpg", "not-a-real-jpeg");
  return root;
}

export async function tiktokExport(): Promise<string> {
  const root = await tempDir();
  await put(
    root,
    "user_data.json",
    JSON.stringify({
      Profile: { "Profile Information": { ProfileMap: { userName: "ada", nickName: "Ada" } } },
      Video: {
        Videos: {
          VideoList: [
            { Date: "2024-01-05 12:00:00", Link: "https://v16.tiktokcdn.com/abc.mp4", Likes: "17" },
          ],
        },
      },
      Activity: {
        "Like List": { ItemFavoriteList: [{ date: "2024-01-06 08:00:00", link: "https://www.tiktok.com/@x/video/1" }] },
      },
      "Direct Messages": {
        "Chat History": {
          ChatHistory: {
            "Chat History with grace:": [
              { Date: "2024-01-07 10:00:00", From: "grace", Content: "hello" },
            ],
          },
        },
      },
    }),
  );
  return root;
}

export async function snapchatExport(): Promise<string> {
  const root = await tempDir();
  await put(root, "json/account.json", JSON.stringify({ "Basic Information": { Username: "ada" } }));
  await put(
    root,
    "json/memories_history.json",
    JSON.stringify({
      "Saved Media": [
        {
          Date: "2024-01-08 15:04:05 UTC",
          "Media Type": "Image",
          "Download Link": "https://app.snapchat.com/dmd/memories?uid=abc",
        },
      ],
    }),
  );
  await put(
    root,
    "json/chat_history.json",
    JSON.stringify({
      grace: [
        { From: "grace", "Media Type": "TEXT", Created: "2024-01-09 11:00:00 UTC", Content: "yo" },
        { From: "ada", "Media Type": "IMAGE", Created: "2024-01-09 11:01:00 UTC" },
      ],
    }),
  );
  return root;
}

export async function mastodonExport(): Promise<string> {
  const root = await tempDir();
  await put(
    root,
    "actor.json",
    JSON.stringify({ preferredUsername: "ada", name: "Ada Lovelace" }),
  );
  await put(
    root,
    "outbox.json",
    JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      orderedItems: [
        {
          type: "Create",
          published: "2024-01-10T12:00:00Z",
          object: {
            id: "https://mastodon.example/users/ada/statuses/1",
            type: "Note",
            content: "<p>first post</p><p>second &amp; last paragraph</p>",
            published: "2024-01-10T12:00:00Z",
            url: "https://mastodon.example/@ada/1",
            attachment: [{ url: "/media_attachments/files/1/original/pic.png", mediaType: "image/png" }],
          },
        },
        // A boost: the object is a bare URL and carries no content of its own.
        { type: "Announce", published: "2024-01-11T12:00:00Z", object: "https://elsewhere/1" },
      ],
    }),
  );
  await put(root, "media_attachments/files/1/original/pic.png", "not-a-real-png");
  return root;
}
