# Contributing

Thanks for being here. This project exists because data portability is a legal right
that platforms honour badly, and every adapter someone writes makes that a little
less true.

## Setup

```bash
git clone https://github.com/deliseph/archivore.git
cd archivore
npm install
npm test
```

Node 20+. There is no other prerequisite, no build tooling to configure, and one
runtime dependency.

```bash
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run build       # compile to dist/
node dist/cli.js inspect some-export.zip
```

## The one hard rule: never commit real data

Not yours, not anyone's. Export files contain private messages, and a git history is
forever.

Fixtures are **hand-written** to match the real file layout with invented content —
see `tests/fixtures.ts`. `.gitignore` blocks `*.zip` and `/archive/` as a backstop,
but the backstop is not the plan.

If you're reporting a bug in a specific export, describe the file layout and paste a
**redacted** snippet of the JSON structure. Never attach the export.

## What's most useful

**Adapters for new platforms.** The main thing this project needs. About 100 lines,
and [docs/writing-an-adapter.md](docs/writing-an-adapter.md) walks through one end to
end. Facebook, Reddit, LinkedIn, Discord, YouTube, Bluesky, Spotify, Strava and
WhatsApp are all open.

**Format corrections.** Platforms change their export layouts without announcement,
which silently breaks adapters. If your export doesn't match what an adapter expects,
that report is valuable even without a fix.

**The expiring-link downloader.** TikTok and Snapchat ship links that die within days.
Fetching them before they expire is the highest-value missing feature — and needs
careful design, since it would be the first code here that touches the network.

**Documentation.** Which platforms bury the export button where, how long each takes,
what each one silently omits. You don't need to write code to contribute this.

## Pull requests

- Branch from `main`.
- `npm test && npm run typecheck` before pushing. CI runs both on Node 20 and 22.
- Match the surrounding style. There's no linter to argue with; just read the
  neighbouring file.
- Comments should explain *why*, especially where a platform's format is strange.
  Most of the tricky code here is tricky because the export format is.
- Small PRs get reviewed faster. An adapter alone is a great PR.

Draft PRs are welcome. If you're stuck on a format, open one and ask.

## Adding a network call

Archivore makes zero network requests, and the README promises that. It's the main
reason people trust it with the most sensitive file they own.

Any feature that changes this needs to be opt-in behind an explicit flag, off by
default, and documented in the README. Please open an issue to discuss before
building it. This isn't a "no" — the expiring-link downloader clearly needs it — it's
a "let's get the shape right first."

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
