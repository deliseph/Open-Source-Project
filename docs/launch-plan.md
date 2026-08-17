# Launch plan

An honest, specific plan for getting Archivore used — and what that means for the
[Claude for Open Source](https://claude.com/contact-sales/claude-for-oss) application.

This is a working document, not marketing. Adjust it as things land.

---

## 1. Before announcing anything

Do all of this first. Launching to a repo that isn't ready wastes the one moment you
get everyone's attention.

- [ ] **Rename the repo to `archivore`.** It's currently `open-source-project`, which
      reads as abandoned. GitHub redirects the old URL automatically, so nothing breaks.
      Every link in this repo already assumes `deliseph/archivore`.
- [ ] **Write the repo description**: *"Turn your Instagram, TikTok, Snapchat and X
      exports into one searchable archive you own. Offline, no tracking, MIT."*
- [ ] **Add topics**: `data-portability`, `gdpr`, `privacy`, `self-hosted`, `archive`,
      `social-media`, `instagram`, `digital-preservation`, `offline`, `cli`.
- [ ] **Publish to npm**: `npm publish`. The `npx archivore` line in the README has to
      work the second someone reads it, or you lose them.
- [ ] **Record a 20-second terminal GIF** — run the command, then show the HTML page.
      Put it at the top of the README. This converts better than any paragraph.
      [`vhs`](https://github.com/charmbracelet/vhs) makes reproducible ones.
- [ ] **Set a social preview image** (Settings → Social preview). Links without one
      look like spam on Mastodon and Bluesky.
- [ ] **Open 8–10 issues before launch**, labelled `good first issue` and `adapter`.
      An empty issue tracker gives an interested person nowhere to go. Seed it with:
      Facebook, Reddit, LinkedIn, Discord, YouTube, Bluesky, Spotify, Strava, WhatsApp
      adapters, plus the expiring-link downloader.
- [ ] **Enable Discussions.** Support questions there keep the issue tracker legible.

## 2. The hook

Do not lead with "I built a tool for social media exports." Nobody wants another tool.

Lead with the bug:

> **Instagram has been corrupting every emoji in your data export for years.**
> A 😀 is four UTF-8 bytes, and Instagram writes each byte as a separate Latin-1
> character, so your export says `ð`. It's been like that since at
> least 2018. It's reversible in about 20 lines. I fixed that, and four other things,
> and put it in a tool that turns the ZIP into an archive you can actually read.

This works because it is specific, surprising, verifiable in thirty seconds by anyone
with an export, and it demonstrates that you actually read the files rather than
wrapping someone's API. Technical audiences reward exactly that.

The secondary hook, for privacy audiences: **zero network calls, one dependency,
and CI that fails the build if either changes.** That's a claim almost nothing in this
space can make, and it's checkable.

## 3. Where to post, in order

Sequence matters. Start with the communities most likely to be *delighted*, gather
proof, then go to the big general ones.

**Week 1 — the people who already care**

| Where | Why it fits | Notes |
| --- | --- | --- |
| [r/DataHoarder](https://reddit.com/r/DataHoarder) | ~1M people whose entire hobby is this | Highest-fit audience anywhere. Lead with the archive output |
| [r/selfhosted](https://reddit.com/r/selfhosted) | Offline + no telemetry is the whole ethos | |
| [r/privacy](https://reddit.com/r/privacy) | GDPR angle | Lead with "your legal right, honoured badly" |
| Mastodon / fediverse | Data portability is *why these people are there* | Tag `#fediverse` `#dataportability`. The Mastodon adapter is your credential here |
| Bluesky | Same crowd, add a Bluesky adapter first if you can | |

**Week 2 — general technical, once you have a few stars and a testimonial**

| Where | Notes |
| --- | --- |
| **Show HN** | Tuesday–Thursday, 8–10am US Eastern. Title: *"Show HN: Archivore – Instagram has been corrupting every emoji in your data export"*. Be in the thread all day; HN rewards a responsive author more than a polished post |
| [Lobste.rs](https://lobste.rs) | Needs an invite. Tag `privacy`, `unix` |
| Hacker News comments | When an export/privacy thread appears organically, a genuinely helpful reply beats any launch post |

**Ongoing — durable discovery, worth more than any launch spike**

- PR yourself onto [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted),
  [awesome-privacy](https://github.com/pluja/awesome-privacy), and
  [awesome-datahoarding](https://github.com/simon987/awesome-datahoarding). These
  send traffic for years, not for a day.
- Newsletters: [Console.dev](https://console.dev), [TLDR](https://tldr.tech),
  Changelog Nightly. They actively look for new OSS.
- Answer the existing StackOverflow / Reddit questions about mangled Instagram export
  encoding. Those threads get found by search forever.

## 4. What converts a visitor into a contributor

Stars are vanity; contributors are what make the project survive and what the
Ecosystem Impact Track actually cares about.

The funnel here is deliberate:

1. The README says adapters are ~100 lines and links a real walkthrough.
2. `docs/writing-an-adapter.md` is a complete worked example, not an API dump.
3. The issue template lets someone contribute a **format description** with no code —
   the lowest-effort useful contribution there is.
4. The PR template turns the adapter checklist into ticks.

Then, when someone shows up:

- **Reply within 24 hours, always.** The single strongest predictor of a second
  contribution.
- **Merge small things fast.** A typo fix merged in an hour buys enormous goodwill.
- **Credit adapter authors in the README table.** Public credit is most of the pay.
- When someone files a format description, reply: *"this is enough to write the
  adapter — want to try it? I'll review."* Many will say yes.

## 5. Milestones

| Milestone | What it signals |
| --- | --- |
| 10 stars | Your immediate network. Means nothing yet |
| 100 stars | The hook works |
| 3 outside adapters merged | **The important one.** The architecture works for people who aren't you |
| 500 stars | Real discovery; expect format-change bug reports |
| Listed in 2+ awesome-lists | Durable traffic independent of launches |
| 1,000 stars | Credible Ecosystem Impact Track application |
| 5,000 stars | Maintainer Track eligibility |

## 6. About the Claude for Open Source application

Being straight about the timeline, because the program's bar is real:

**Eligibility is 5,000+ GitHub stars or 1M+ monthly npm downloads**, with active
contributions in the last 3 months. There's a second **Ecosystem Impact Track** for
critical-but-lower-profile infrastructure, judged on a written case. The program grants
6 months of Claude Max 20x (~$1,200) to an individual — not API credits, not team seats
— and is capped at 10,000 recipients, reviewed on a rolling basis.

**A new repository does not qualify, and no amount of launch effort changes that this
month.** Anyone promising otherwise is selling something.

The realistic path is the **Ecosystem Impact Track**, and it's a 6–18 month goal. What
makes that case winnable is not star count — it's demonstrating that the project is
depended upon. Concretely, build toward:

- **Outside contributors.** A project with 12 adapter authors is infrastructure; a
  project with one is a personal tool. This is the strongest signal you can generate,
  and it's why the adapter architecture is the way it is.
- **Downstream usage.** The library API exists so other tools can build on the schema.
  If a digital-preservation or self-hosting project depends on `archivore`, say so in
  the application — that's exactly what "critical but less visible" means.
- **Sustained activity.** "Active in the last 3 months" is checked. Steady commits beat
  a burst.
- **A specific written case.** Not "my project is popular" but: *"data portability is a
  legal right that five major platforms honour with unusable formats; Archivore is the
  only open-source tool that reads all of them, N contributors maintain the adapters,
  and M projects depend on the schema."*

Apply when you can write that paragraph truthfully. Rolling review means there's no
deadline advantage to applying before you can — and a thin application is a wasted shot.

**In the meantime:** the [Anthropic Startup Program](https://www.anthropic.com/startups)
and free-tier Claude Code both exist, and neither requires 5,000 stars.

## 7. Realistic risks

- **Formats change without warning.** This is the main long-term maintenance cost. It's
  also the reason contributors stay useful — nobody has accounts on every platform.
- **A launch spike decays fast.** The awesome-list PRs and search-indexed answers matter
  more in month six than the Show HN does.
- **Scope creep toward cross-posting.** People will ask. Don't. That market is saturated
  (Bridgy Fed, Croissant, Openvibe, Buffer) and it would compromise the "reads only,
  never touches your account" property that makes this trustworthy.
