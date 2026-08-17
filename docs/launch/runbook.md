# Launch runbook

Sequence and timing. Copy for every post is in [posts.md](posts.md); the strategy behind
it is in [../launch-plan.md](../launch-plan.md).

**Archivore launches first.** Crosscheck follows 4–6 weeks later and inherits the
audience. Do not launch both at once — you halve the attention on each and have nothing
left to say the second time.

---

## Week 0 — before anyone sees it

None of this is optional. Launching to a repo that isn't ready wastes the one moment you
get everybody's attention, and you don't get a second one.

- [ ] **Rename the repo to `archivore`.** GitHub redirects the old URL, so nothing
      breaks. Every link in the project already assumes `deliseph/archivore`.
- [ ] **Repo description**: *Turn your Instagram, TikTok, Snapchat and X exports into one
      searchable archive you own. Offline, no tracking, MIT.*
- [ ] **Topics**: `data-portability` `gdpr` `privacy` `self-hosted` `archive`
      `social-media` `instagram` `digital-preservation` `offline` `cli`
- [ ] **`npm publish`.** The `npx archivore` line has to work the second someone reads
      it. If it 404s you lose them and they don't come back.
- [ ] **Social preview image** (Settings → Social preview). `docs/launch/social-preview.png`
      is ready to upload. Links without one look like spam on Mastodon and Bluesky.
- [ ] **Terminal GIF at the top of the README.** `docs/launch/demo.tape` is a
      [vhs](https://github.com/charmbracelet/vhs) script — `vhs docs/launch/demo.tape`.
      This converts better than any paragraph you could write.
- [ ] **Open 8–10 issues, labelled `good first issue` and `adapter`**: Facebook, Reddit,
      LinkedIn, Discord, YouTube, Bluesky, Spotify, Strava, WhatsApp, plus the
      expiring-link downloader. An empty tracker gives an interested person nowhere to go.
- [ ] **Enable Discussions**, so support questions don't clutter issues.
- [ ] **Re-read `the-instagram-emoji-bug.md` as a hostile reader.** It is the submission.
      Every claim in it is verifiable, which is why it works — keep it that way.

**Do not skip the issues step.** The single biggest waste in an OSS launch is a spike of
interested developers landing on a repo with nothing to pick up.

---

## Week 1 — launch

### Day 1 (Tue/Wed/Thu), 8–10am US Eastern

1. **Submit the write-up to Hacker News.** Title and first comment in
   [posts.md §1](posts.md). Post your explanatory comment immediately.
2. **Then stay available for six hours.** This is the actual work. HN rewards a
   responsive author far more than a polished post. Answer every question, concede every
   fair point.
3. Do **not** post anywhere else today. If HN takes off you want your whole attention
   there; if it doesn't, you still have every other channel unspent.

If it flops: HN is substantially luck and timing. It is completely normal to resubmit a
genuinely good post once, a week or two later, at a different hour. Do not resubmit the
same day.

### Day 2 — r/DataHoarder

Your highest-fit audience. Copy in [posts.md §2](posts.md). Answer every comment.

### Day 4–5 — r/privacy

Different angle (the GDPR one), not the same text. [posts.md §3](posts.md).

### Day 5 — fediverse

Mastodon thread ([§5](posts.md)) and Bluesky ([§6](posts.md)). Attach the screenshot.
The Mastodon adapter is your credential with this crowd — lead with it.

---

## Week 2 — the durable part

This matters more in month six than launch day does, and almost nobody does it.

- [ ] **Awesome-list PRs** ([§7](posts.md)) — awesome-selfhosted, awesome-privacy,
      awesome-datahoarding. These send traffic for years.
- [ ] **r/selfhosted** ([§4](posts.md)).
- [ ] **Answer existing questions.** Search Reddit and Stack Overflow for people asking
      why their Instagram export shows `Ã©`. Answer the question properly and mention the
      tool at the end. Those threads get found by search forever.
- [ ] **Newsletters**: Console.dev, TLDR, Changelog Nightly. They actively look for new
      OSS and a one-paragraph email is enough.

---

## Ongoing — the only metric that matters

Stars are vanity. **Outside contributors** are what make the project survive, and what
the Claude for OSS Ecosystem Impact Track actually assesses.

- **Reply within 24 hours, always.** The strongest predictor of a second contribution.
- **Merge small things fast.** A typo fix merged in an hour buys enormous goodwill.
- **Credit adapter authors in the README table.** Public credit is most of the pay.
- When someone files a format description, reply: *"this is enough to write the adapter
  — want to try it? I'll review."* A surprising number say yes.

| Milestone | What it means |
| --- | --- |
| 100 stars | The hook works |
| **3 outside adapters merged** | **The important one** — the architecture works for people who aren't you |
| Listed in 2+ awesome-lists | Durable traffic, independent of launches |
| 1,000 stars | Credible Ecosystem Impact Track application |

---

## Crosscheck, 4–6 weeks later

Same shape, different hook and different rooms.

- **Hook**: not "I built an orchestrator" — there are nine of those. It's *"running the
  same model twice doesn't catch its mistakes; running a different lab's model does."*
  Lead with a real CONFIRMED-vs-DISPUTED output block.
- **Rooms**: r/LocalLLaMA, r/ChatGPTCoding, Show HN, the Aider and OpenCode Discords,
  awesome-cli-coding-agents.
- **Prerequisite**: land 2–3 more agent specs first (Cursor CLI, Amp, Qwen Code). The
  tool is only useful to someone who has two vendors installed, so breadth of support
  *is* the addressable market.

---

## Things not to do

- **Don't post to five subreddits the same day.** It reads as spam, and Reddit will
  filter you.
- **Don't buy stars or ask for them.** GitHub delists for it, and it fools nobody.
- **Don't argue in threads.** Concede fair points publicly; it recruits contributors.
- **Don't announce a roadmap you won't build.** Ship the expiring-link downloader before
  promising it.
- **Don't start a third project.** You have two finished ones. A third is how both die.
