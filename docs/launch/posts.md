# Launch copy

Ready to paste. Each is written for its channel — **do not cross-post the same text.**
Identical copy in five places reads as spam, and on Reddit it will get you filtered.

Replace `deliseph/archivore` if the repo ends up somewhere else.

---

## 1. Hacker News — the main play

Submit the **write-up**, not the repo. Technical posts consistently outperform "Show HN:
I built a tool", because people share a finding more readily than a product.

**URL:** `https://github.com/deliseph/archivore/blob/main/docs/the-instagram-emoji-bug.md`

**Title:**

```
Instagram mangles every emoji in your data export
```

Rules for the title: no "I built", no exclamation mark, no "Show HN" (this isn't one),
under 80 characters. It states a fact the reader can check. That's the entire job.

**Post it Tuesday–Thursday, 8–10am US Eastern.** Then stay at your desk for six hours.
Being responsive in the thread matters more than anything you wrote.

**First comment — post this yourself, immediately after submitting:**

```
Author here. The short version: UTF-8 is variable-width, so "é" is two bytes and "😀"
is four. Instagram's exporter decodes the file as Latin-1 somewhere, which is
single-byte, so each byte becomes its own character. Ten bytes in, ten characters out
instead of six.

It's reversible — reinterpret each character as a byte and decode as UTF-8 — but you
can't apply that blindly. Doing it to "50° today" produces "50<?> today", because 0xB0
is a UTF-8 continuation byte with no lead byte, so the decoder replaces it and the
degree sign is gone. The guard is that mojibake is always valid UTF-8 when reinterpreted
and genuine Latin-1 text usually isn't, so you attempt it and keep the result only if it
decodes cleanly. That also makes it idempotent, which is what lets you run it over a
whole export where some files are damaged and some aren't.

Happy to answer questions about the other export formats. Snapchat's is the strangest:
your memories aren't in the ZIP at all, just download links that expire about a week
after the export is generated.
```

---

## 2. r/DataHoarder — highest-fit audience anywhere

~1M people whose hobby is exactly this. Lead with **preservation**, not the encoding bug.

**Title:**

```
I got tired of social media exports being unreadable, so I wrote a tool that merges
them into one browsable archive (Instagram, TikTok, Snapchat, X, Mastodon)
```

**Body:**

```
Every platform gives you a ZIP of JSON and calls it data portability. Five platforms
means five piles of it on your desktop that you'll never open again.

Archivore reads them all and writes one archive:

- index.html — a single self-contained page. Search and filter your whole history,
  every platform in one timeline. Works offline, no server, just double-click it.
- archive.json — everything in one documented schema
- media/ — all your photos and videos, organised by platform
- markdown/ — one file per month, drops straight into Obsidian

  npx archivore build instagram.zip tiktok.zip snapchat.zip x-archive/

Things I learned building it that are relevant to this sub:

- Snapchat memories are NOT in the export. It's a list of download links that expire
  about a week after the export is generated. If you requested one and sat on it, those
  photos are already gone.
- TikTok's videos are the same deal — links, not files, and they expire faster.
- Instagram's JSON has every emoji and accent corrupted (it writes UTF-8 one byte at a
  time as Latin-1). The tool repairs it.
- Exports take up to 4 days to arrive and the download link expires in about a week, so
  request all of them now, then run this once they land.

It's MIT, zero network calls (there's no HTTP client in the dependency tree, and CI
fails if anyone adds one), and one runtime dependency for reading ZIPs.

Adapters are ~100 lines. Facebook, Reddit, LinkedIn, Discord and Bluesky are open
issues if anyone wants one.

https://github.com/deliseph/archivore
```

**Expect to be asked:** "why not just keep the ZIP?" Answer: because the links inside it
expire and the captions are separated from the photos. That is a real answer; give it.

---

## 3. r/privacy — different angle, post 2–3 days later

Do **not** post the same day as r/DataHoarder.

**Title:**

```
GDPR gives you the right to your data. It doesn't say the file has to be usable.
```

**Body:**

```
Article 20 says you're entitled to your personal data in a "structured, commonly used
and machine-readable format." Every big platform complies. What you get is a
multi-gigabyte ZIP of JSON, four days later, with a download link that expires in a
week — and in Instagram's case, with every emoji and accented character in your captions
silently corrupted.

Technically compliant. Practically useless.

I wrote an MIT-licensed tool that reads those exports and turns them into one searchable
archive you keep. The privacy properties are the point:

- Zero network requests. There is no HTTP client in the dependency tree, and CI fails
  the build if one appears. No telemetry, no update check, no analytics.
- One runtime dependency (a ZIP reader). npm audit is clean.
- The generated page embeds its data and loads nothing remotely — CI asserts it contains
  no external src/href and no fetch call.
- Your export is never modified. It only reads.

It also never touches your account. There's no login, no scraping, no automation —
it reads the file the platform already gave you, so it can't get anyone banned.

  npx archivore build instagram.zip

https://github.com/deliseph/archivore
```

---

## 4. r/selfhosted — post in week 2

**Title:**

```
Archivore — self-hosted archive of your social media exports, fully offline
```

**Body:**

```
Reads the export ZIPs from Instagram, TikTok, Snapchat, X and Mastodon and builds a
single browsable archive: one self-contained index.html with search and filtering,
plus JSON and per-month Markdown.

No server, no container, no database — the output is plain files on disk. Point a
browser at index.html, or serve the folder from whatever you already run. Node 20+ is
the only prerequisite.

Zero network calls by design, enforced in CI. MIT.

https://github.com/deliseph/archivore
```

---

## 5. Mastodon / fediverse

This audience *chose* their platform over data-portability values. The Mastodon adapter
is your credential — lead with it. Post as a thread; the first toot has to stand alone.

```
Instagram's data export corrupts every emoji in your captions. "café 😀" arrives as
"cafÃ© ðŸ˜€" because the exporter writes UTF-8 one byte at a time as if it were
Latin-1.

I wrote a tool that repairs it, and reads TikTok, Snapchat, X and Mastodon exports too,
into one searchable offline archive.

#dataPortability #privacy
```

```
2/ Mastodon's export is the one that shows how it should be done: an ActivityPub
outbox, an open standard, media bundled as real files, stable IDs.

Because it's a standard and not a vendor format, the same adapter reads Pleroma,
Akkoma and GoToSocial exports unchanged. That's the whole argument for open protocols
in one file.
```

```
3/ Meanwhile Snapchat doesn't put your memories in the export at all — just download
links that expire about a week after it's generated. TikTok does the same with videos.

If you requested an export and left it sitting, that media may already be gone.
```

```
4/ MIT, zero network calls (no HTTP client in the dependency tree, CI fails if one
appears), one runtime dependency.

npx archivore build instagram.zip

https://github.com/deliseph/archivore
```

---

## 6. Bluesky

Shorter and punchier. One post, one image (the terminal screenshot), one link.

```
Instagram's data export mangles every emoji in your captions.

"café 😀" → "cafÃ© ðŸ˜€"

It writes UTF-8 one byte at a time as Latin-1. It's been like this for years.

I wrote an MIT tool that repairs it and merges your Instagram, TikTok, Snapchat, X and
Mastodon exports into one searchable offline archive 👇
```

---

## 7. Awesome-list pull requests

Worth more over a year than any launch spike. One line each, matching the file's
existing format. Submit these in **week 2**, once the repo has a few stars.

- [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted) →
  Archiving and Digital Preservation
- [awesome-privacy](https://github.com/pluja/awesome-privacy)
- [awesome-datahoarding](https://github.com/simon987/awesome-datahoarding)

```
- [Archivore](https://github.com/deliseph/archivore) - Merge social media export ZIPs
  (Instagram, TikTok, Snapchat, X, Mastodon) into one searchable offline archive.
  `MIT` `Nodejs`
```

Read each list's CONTRIBUTING first — most have strict formatting and will close a PR
that ignores it.

---

## 8. Replies to predictable pushback

Have these ready. Answering well in public is worth more than the original post.

**"Isn't this just a ZIP extractor?"**

```
The extraction is the easy part. The work is that each platform's format is different
and lossy in a different way — Instagram separates captions from photos and corrupts
the text encoding, X stores its JSON as JavaScript with a window.YTD assignment on the
front, Snapchat and TikTok ship expiring links instead of files. It normalises all of
that into one schema and one timeline.
```

**"Why not just use [commercial tool]?"**

```
Mostly because none of them are open source, and this is the most sensitive file you
own — a complete archive of your private messages. You shouldn't have to trust a
promise about what happens to it. This makes no network requests at all, which you can
verify in about 2,200 lines, and CI fails the build if anyone adds an HTTP client.
```

**"Instagram fixed that encoding bug."**

```
Entirely possible it's been fixed for newer exports — I'd genuinely like to know. The
repair is a no-op on correctly-encoded text (it bails as soon as it sees a character
above U+00FF, which proves the string decoded properly), so it costs nothing either
way. If you have a recent export where captions are clean, please open an issue and
say which month it's from — that's useful data.
```

Never argue. If someone is right, say so and thank them. A maintainer who concedes a
point gracefully in public gets more contributors than one who wins the argument.
