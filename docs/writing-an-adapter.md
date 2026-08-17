# Writing an adapter

An adapter teaches Archivore to read one platform's export. It's two methods and
usually under 150 lines. This walks through a complete one.

You do **not** need to be an expert in the platform. You need one export to look at —
yours, or one a contributor described in an issue.

## The contract

```ts
interface Adapter {
  id: string;              // "reddit" — ends up in entry ids and folder names
  name: string;            // "Reddit"
  requestUrl?: string;     // where a user goes to request this export

  detect(source: Source): Promise<number>;              // 0–1 confidence
  parse(source: Source, ctx: ParseContext): Promise<ParseResult>;
}
```

`Source` is a read-only view over the export. It behaves identically whether the user
pointed at a `.zip` or an unzipped folder, so you never handle ZIPs yourself:

```ts
source.list()                  // every file path, sorted
source.exists("data/x.json")
source.read(path)              // Buffer
source.readText(path)          // string, BOM stripped
source.readJSON<T>(path)       // parsed
source.find(/^data\/.*\.json$/) // paths matching a pattern
```

All paths are POSIX-style and relative to the export root.

## Step 1: look at the export

Unzip one and read the tree. You're looking for two things: a **marker file** that
identifies this platform, and the files holding the actual content.

```bash
unzip -l reddit_export.zip | head -40
```

## Step 2: detect

Return your confidence that this export belongs to your platform. Look for marker
**files**, never the folder name — people rename downloads.

```ts
async detect(source) {
  if (await source.exists("posts.csv")) return 1;      // conclusive
  if (await source.exists("statistics.csv")) return 0.6; // suggestive
  return 0;
}
```

Return `0` when nothing matches. The registry runs every adapter and picks the highest
scorer, so a confident wrong answer breaks other platforms — be honest with the number.

If a marker filename is generic (`user_data.json` could be anyone's), open it and check
for a schema key you recognise before returning a high score. `src/adapters/tiktok.ts`
does exactly this.

## Step 3: parse

Turn records into `Entry` objects. The full shape is in `src/core/types.ts`; the
required fields are `id`, `platform`, `kind`, `createdAt` and `media`.

```ts
import { result, safely } from "../core/adapter.js";
import { parseTimestamp, stableId, guessMediaKind } from "../core/util.js";

async parse(source, ctx) {
  const profile = { platform: "reddit" };
  const entries = [];

  for (const path of await source.find(/^posts\.json$/)) {
    // `safely` turns a crash into a warning — one bad file must never cost
    // the user the rest of a multi-gigabyte import.
    await safely(ctx, path, async () => {
      for (const post of await source.readJSON(path)) {
        const createdAt = parseTimestamp(post.date);
        if (!createdAt) continue;   // skip, don't throw

        entries.push({
          id: post.id ? `reddit-${post.id}` : stableId("reddit", post.permalink),
          platform: "reddit",
          kind: "post",
          createdAt,
          text: post.body,
          media: [],
          url: post.permalink,
          raw: post,               // always keep the original
        });
      }
    });
  }

  return result(profile, entries, ctx);   // sorts newest-first for you
}
```

### The five rules

1. **Never throw for a recoverable problem.** Wrap file reads in `safely()`. A truncated
   file should produce a warning and 90% of an archive, not a stack trace and nothing.
2. **Always set `raw`.** It's how a future version extracts more without making the user
   re-download a 4GB ZIP that took four days to arrive.
3. **Use `parseTimestamp`.** It handles Unix seconds, milliseconds, ISO 8601 and the
   `2024-03-11 09:14:02 UTC` shape. Skip entries with no usable date.
4. **Make ids stable.** Use the platform's id if there is one. Otherwise `stableId()`
   hashes content, so re-importing an overlapping export de-duplicates instead of doubling.
5. **Warn about what's missing.** If media is a link rather than a file, or the export
   only covers 90 days, say so via `ctx.warn()`. Users need to know before they delete
   the original.

### Text that looks mangled

If captions come out as `cafÃ©` or `ð`, the platform has the same
Latin-1 bug Instagram does. Run the parsed JSON through `repairDeep`:

```ts
import { repairDeep } from "../core/text.js";
const data = repairDeep(await source.readJSON(path));
```

It's a no-op on healthy text, so it's safe to apply broadly.

### Media

`sourcePath` is the path **inside the export**. The archive builder copies the file out.

```ts
media: [{ sourcePath: "media/posts/photo.jpg", kind: guessMediaKind(path) }]
```

If the platform gives a URL instead of a file (TikTok and Snapchat do), put the URL in
`sourcePath` and warn that it expires. Archivore won't try to copy it, and the HTML page
renders it as a link.

## Step 4: register it

Two lines in `src/core/registry.ts`:

```ts
import { reddit } from "../adapters/reddit.js";
export const adapters = [instagram, x, tiktok, snapchat, mastodon, reddit];
```

And re-export it from `src/index.ts` so library users can reach it.

## Step 5: fixtures and tests

**Never commit a real export.** Build a miniature one by hand in `tests/fixtures.ts`,
matching the real layout with invented content:

```ts
export async function redditExport(): Promise<string> {
  const root = await tempDir();
  await put(root, "posts.json", JSON.stringify([
    { id: "abc", date: "2024-01-05 12:00:00 UTC", body: "hello", permalink: "https://…" },
  ]));
  return root;
}
```

Then cover, at minimum: detection succeeds, entries parse, and dates land correctly.
Copy the shape of an existing block in `tests/adapters.test.ts`.

```bash
npm test
npm run typecheck
```

## Checklist

- [ ] `detect` uses file contents, returns `0` when unsure
- [ ] `parse` never throws — file reads wrapped in `safely()`
- [ ] `raw` set on every entry
- [ ] `ctx.warn()` for anything the export omits or lets expire
- [ ] Registered in `src/core/registry.ts` and exported from `src/index.ts`
- [ ] Hand-written fixture, no real personal data
- [ ] Row added to the README table
- [ ] `npm test && npm run typecheck` pass

Open the PR even if a box is unticked — a half-finished adapter with a real format
description is more useful than a perfect one that never gets written.
