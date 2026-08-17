# Radar

**Finds the conversations. Never joins them.**

Radar searches public APIs for threads where Archivore or Crosscheck would genuinely
help, scores them, and writes you a digest with a draft reply. You read it, you decide,
you post in your own words.

Maintainer tooling — not part of the published package.

---

## What it will not do

Radar has **no ability to post, vote, comment, or message anyone.** That is enforced by
construction, not by policy: the only network function in the codebase is a `getJson`
helper with no `method` and no `body` parameter, and `tests/no-write.test.ts` fails the
build if a mutating verb or a posting endpoint ever appears in the source.

This is not squeamishness. Automated promotion is the fastest way to destroy the thing
you are trying to build:

- **Hacker News** bans automated submission and voting rings at the **domain** level. One
  attempt and `archivore` links are permanently dead there.
- **Reddit** shadowbans automation *silently*. You keep posting and nobody sees it, and
  you have no way to tell.
- **Mastodon** instances defederate spam sources within hours, and the fediverse is the
  single most sympathetic audience this project has.
- **Claude for Open Source** is assessed by a human reading your repository. Inflated
  stars with no contributors and no downstream dependents is exactly the pattern that
  fails an Ecosystem Impact review. Manufacturing engagement to qualify turns a winnable
  application into a disqualifying one.

The slow version works. Answering a question someone actually asked keeps ranking in
search for years, and it recruits contributors, which is the metric that matters.

## Use

```bash
npm install && npm run build

node dist/cli.js leads --days 730 --out leads.md   # threads you could help in
node dist/cli.js mentions --days 7                 # who's talking about you
node dist/cli.js stats                             # honest progress
```

| Option | |
| --- | --- |
| `--project archivore\|crosscheck` | which lead set |
| `--days <n>` | how far back to look |
| `--min <0-1>` | relevance threshold (default `0.45`) |
| `--all` | include threads shown in a previous run |
| `--out <file>` | write the digest to a file |

State lives in `.radar/state.json` so each run only shows you new things. Delete it to
start over.

`stats` works unauthenticated at 60 requests/hour; set `GITHUB_TOKEN` for more.

## What a digest looks like

```
## mangled export encoding

### Instagram export weird characters instead of emoji?

r/Instagram · 3d ago · 0 comments · relevance 1.00

<https://www.reddit.com/r/Instagram/comments/1/>

> Downloaded my data and every caption shows cafÃ© and ðŸ˜€ garbage. Is my file corrupted?

<details><summary>Draft reply — edit before sending</summary>
```

## How it decides

Scoring is deliberately **harsh**. Three genuine leads you read properly beat thirty
maybes you skim — a long list is how people stop reading threads and start pasting,
which is the exact failure mode to avoid.

- A term match in the **title** counts double a match in the body. Someone whose title is
  the question you answer is asking it; someone who mentioned it mid-thread is not.
- **Unanswered threads rank highest.** Nobody has helped them yet.
- Threads with **150+ comments are halved** — your reply will not be seen, and posting
  into one reads as chasing attention.
- **Listicles and megathreads are cut to 30%.** A thread that exists to list tools is not
  a place to add yours.
- Anything over two years old is discounted but not dropped, because search traffic
  outlives the thread.
- NSFW threads are excluded entirely.

Every modifier is a penalty, never a boost — boosting and then clamping to 1 would
silently flatten the ranking for the strongest matches.

## The rules for replying

The drafts in `src/queries.ts` all follow these. Keep it that way if you add more.

1. **Answer the question first.** If you can't help without mentioning your tool, that
   thread isn't a lead. Skip it.
2. **Disclose that you wrote it.** Both Reddit and HN require this, and undisclosed
   self-promotion is what gets accounts filtered.
3. **Rewrite it in your own words.** Pasting a draft verbatim is the fastest way to be
   read as a bot. The drafts are a starting point, never a script.
4. **Never reply twice to the same person**, and never DM anyone.

## Adding a lead query

Add an entry to `ARCHIVORE_LEADS` or `CROSSCHECK_LEADS` in `src/queries.ts`:

```ts
{
  topic: "short label for the digest",
  terms: ["what people actually type into search"],
  subreddits: ["DataHoarder"],   // scoping matters — the same question is an
  maxAgeDays: 1095,              // invitation in one sub and an intrusion in another
  draft: `Answer the question. Disclose. Mention the tool last, or not at all.`,
}
```

Write the terms as the person would phrase them, not as you would describe your project.
Nobody searches for "social media export normalisation tool"; they search for "instagram
export weird characters".

## Feeding results back into development

The digest is plain Markdown, so the fastest loop is to hand it straight to a coding
session:

```bash
node dist/cli.js leads --days 730 --out leads.md
claude "read leads.md — what are people actually struggling with, and what should
        Archivore do differently as a result? Ignore anything that's just praise."
```

Complaints in these threads are the most honest feature requests you will get, because
nobody in them is trying to be helpful to you.

## Tests

```bash
npm test        # 18 tests, no network access required
```

Source parsing is tested against recorded response shapes rather than live calls, so the
suite is fast and works offline.
