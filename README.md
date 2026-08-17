<div align="center">

# Archivore

**Your social media exports, turned into one archive you actually own.**

Instagram, TikTok, Snapchat, X and Mastodon hand you a ZIP full of JSON and call it
data portability. Archivore turns that pile into a single searchable archive that
opens in your browser — offline, on your machine, forever.

[![CI](https://github.com/deliseph/archivore/actions/workflows/ci.yml/badge.svg)](https://github.com/deliseph/archivore/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/archivore)](https://www.npmjs.com/package/archivore)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org)

</div>

---

## The problem

You are legally entitled to your data. GDPR Article 20 and the CCPA say so, and every
platform complies — technically.

What compliance looks like in practice:

- You request an export. You wait. **TikTok takes up to four days.**
- A multi-gigabyte ZIP arrives, and the download link expires in about a week.
- Inside: `posts_1.json`, `posts_2.json`, and a `media/` folder where the captions
  have been separated from the photos they belong to.
- Every emoji in your captions reads `ðŸ˜€`. Every accent reads `cafÃ©`.
  Instagram writes UTF-8 one byte at a time as if it were Latin-1, and has for years.
- Snapchat's memories aren't files at all — they're download links that expire.
- Each platform's format is different, so five exports means five piles.

Then you have five ZIPs on your desktop that you will never open again.

## What Archivore does

```bash
npx archivore build instagram.zip tiktok.zip snapchat.zip x-archive/ -o ~/my-archive
```

```
reading instagram.zip…
  Instagram: 8,412 entries
reading tiktok.zip…
  TikTok: 1,203 entries
reading snapchat.zip…
  Snapchat: 4,556 entries
reading x-archive/…
  X (Twitter): 12,090 entries
  copied 3,750 media files…

done — 26,261 entries, 3,904 media files (7.2 GB)

2 things worth knowing:
  ! [snapchat] 1,204 memory item(s) are download links, not files — Snapchat does not
    put your photos in the ZIP, and the links expire roughly a week after the export.
  ! [tiktok] 1,203 video(s) are stored as TikTok download links rather than files, and
    those links expire within days.

open ~/my-archive/index.html to browse it.
```

You get:

```
my-archive/
├── index.html        ← one page. search, filter, scroll your whole history
├── archive.json      ← every entry in one documented schema
├── media/            ← every photo and video, organised by platform
└── markdown/2024/    ← one file per month (--markdown), drops into Obsidian
```

`index.html` is self-contained. Double-click it. No server, no build step, no internet.
It works in ten years on a laptop that has never heard of Node.

## Install

```bash
# no install
npx archivore build ~/Downloads/instagram.zip

# or keep it around
npm install -g archivore
```

Requires Node 20+. That's the only prerequisite.

## Commands

```bash
archivore platforms                    # what's supported, and where to request each export
archivore inspect export.zip           # what's in here? writes nothing
archivore build export.zip [more...]   # build the archive
```

| Option | What it does |
| --- | --- |
| `-o, --out <dir>` | Where to write (default `./archive`) |
| `--platform <id>` | Skip detection, force an adapter |
| `--no-media` | Don't copy photos/videos. Fast, tiny, text only |
| `--markdown` | Also write one Markdown file per month |
| `--json-only` | Skip the HTML page |

Point it at the ZIP exactly as the platform gave it to you — no unzipping needed.
A folder works too, if you already extracted it.

## Supported platforms

| Platform | Posts | Media | Messages | Notes |
| --- | :-: | :-: | :-: | --- |
| Instagram | ✅ | ✅ | ✅ | Also stories and likes. Text repair applied |
| X (Twitter) | ✅ | ✅ | — | Media matched to tweets by filename |
| TikTok | ✅ | ⚠️ | ✅ | Videos are expiring links, not files |
| Snapchat | ✅ | ⚠️ | ✅ | Memories are expiring links, not files |
| Mastodon | ✅ | ✅ | — | Any ActivityPub outbox (Pleroma, GoToSocial…) |

**Want another platform?** That's the main way to contribute, and it's about 100 lines.
See [docs/writing-an-adapter.md](docs/writing-an-adapter.md). Facebook, Reddit, LinkedIn,
Discord, YouTube, Bluesky, Spotify, Strava and WhatsApp are all
[open issues](https://github.com/deliseph/archivore/issues).

## The text repair

This is the bug that makes exports feel broken, so it's worth being specific.

Instagram builds its JSON by taking UTF-8 bytes and writing each byte as if it were a
separate Latin-1 character. A `😀` is the four bytes `F0 9F 98 80`, so it arrives as
four characters and renders as `ðŸ˜€`.

```js
import { repairMojibake } from "archivore";

repairMojibake("cafÃ©");      // → "café"
repairMojibake("ðŸ˜€");    // → "😀"
repairMojibake("50° today");   // → "50° today"  (untouched — this was never broken)
repairMojibake("café 😀");     // → "café 😀"    (untouched — already correct)
```

The repair only commits when the reinterpreted bytes form valid UTF-8, so running it
over healthy text is a no-op. It's exported, tested, and safe to use on its own.

**[Full write-up: why this happens and why you can't fix it blindly →](docs/the-instagram-emoji-bug.md)**

## Privacy

This is a tool for handling the most sensitive file you own. The design follows from that:

- **No network calls. At all.** Not telemetry, not update checks, not analytics.
  There is no HTTP client in the dependency tree. Everything happens on your disk.
- **One runtime dependency** — [`yauzl`](https://github.com/thejoshwolfe/yauzl), to read
  ZIP files. `npm audit` reports zero vulnerabilities.
- **Nothing is uploaded, ever.** The generated page is checked in CI to contain no
  external `src`/`href` and no `fetch` call.
- **Your export is never modified.** Archivore only reads it.

If you want to verify rather than trust: the whole thing is about 2,200 lines, and
`src/core/` is the interesting part.

## Use it as a library

```ts
import { openSource, detect, parseWith, build, writeHtml } from "archivore";

const source = await openSource("./instagram.zip");
const [best] = await detect(source);
const result = await parseWith(best.adapter, source);

console.log(result.profile.handle, result.entries.length);

const bundle = await build([{ source, result }], { outDir: "./out" });
await writeHtml(bundle, "./out");
```

Every entry — a post, a DM, a saved memory — normalises to one shape:

```ts
interface Entry {
  id: string;
  platform: string;        // "instagram", "x", …
  kind: "post" | "story" | "memory" | "message" | "comment" | "like" | …;
  createdAt: Date;
  text?: string;
  media: MediaItem[];
  metrics?: { likes?: number; replies?: number; reposts?: number; views?: number };
  thread?: { conversationId?: string; from?: string; participants?: string[] };
  url?: string;
  raw?: unknown;           // the original record, untouched
}
```

`raw` is always preserved, so a later version can extract more without asking you to
re-download a 4GB ZIP.

## What Archivore does not do

Being straight about this, because the gaps are the point:

- **It cannot recover what the platform didn't give you.** Snaps that expired are gone.
  Instagram Stories are only in the export if you archived them. That's not a bug here.
- **It does not scrape, log in, or automate anything.** It reads the export file you were
  given. Nothing here can get your account banned, because nothing here touches your account.
- **It does not download the expiring links** in TikTok and Snapchat exports yet.
  That's [issue #1](https://github.com/deliseph/archivore/issues) and the most useful
  thing someone could build next.
- **It is not a cross-poster.** It doesn't publish anywhere. It only reads.

## Contributing

New adapters are the best contribution, and the bar is deliberately low: two methods,
`detect` and `parse`, and fixtures written by hand so nobody has to upload real data.

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup and workflow
- [docs/writing-an-adapter.md](docs/writing-an-adapter.md) — a full walkthrough
- [Good first issues](https://github.com/deliseph/archivore/labels/good%20first%20issue)

You do not need to own an account on a platform to help. Format documentation, a
fixture, or a bug report with the file layout is genuinely useful on its own.

## License

[MIT](LICENSE).
