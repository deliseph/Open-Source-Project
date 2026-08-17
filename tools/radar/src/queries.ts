import type { Query } from "./types.js";

/**
 * Where the conversation already is.
 *
 * The highest-converting thing you can do for a project like this is answer
 * the people who already asked the question it solves. Those threads keep
 * ranking in search for years, long after a launch-day spike is gone.
 *
 * Every draft here:
 *   - answers the question first, and mentions the tool last (or not at all)
 *   - discloses that you wrote it, because both Reddit and HN require that
 *     and because undisclosed self-promotion is what gets accounts filtered
 *   - is a starting point to rewrite in your own words, never a script
 *
 * If you cannot answer the person's actual question without the tool, that
 * thread is not a lead. Skip it.
 */

export const ARCHIVORE_LEADS: Query[] = [
  {
    topic: "mangled export encoding",
    terms: [
      "instagram export weird characters",
      "instagram data download emoji broken",
      "instagram json Ã©",
      "instagram export encoding utf-8",
      "facebook export mojibake",
    ],
    subreddits: ["Instagram", "DataHoarder", "learnprogramming", "webdev"],
    maxAgeDays: 1825,
    draft: `Your file isn't broken and neither is your editor — the bytes really are wrong.

UTF-8 is variable-width: "é" is two bytes and "😀" is four. Instagram's exporter
decodes the file as Latin-1 somewhere, which is single-byte, so every byte becomes
its own character. That's why "café 😀" arrives as "cafÃ© ðŸ˜€".

It's reversible. In Python:

    fixed = broken.encode("latin-1").decode("utf-8")

One caveat: don't run that over everything blindly. Applied to text that was never
broken — "50° today" — it produces a replacement character and destroys the degree
sign. The guard is to try it and only keep the result if it decodes without errors.

(Disclosure: I wrote an open-source tool that does this across a whole export, so
I'm not a neutral party — but the two lines above are the whole fix if you just
want that.)`,
  },
  {
    topic: "export unreadable / how do I open this",
    terms: [
      "how to read instagram data export",
      "instagram export json how to view",
      "tiktok data export open",
      "what to do with facebook data download",
    ],
    subreddits: ["DataHoarder", "privacy", "Instagram", "tiktokhelp"],
    maxAgeDays: 1095,
    draft: `The export is JSON plus a media folder, and the two are only loosely connected —
captions live in the JSON and the photos are named by hash, which is why it feels
unusable when you open it.

Two things worth knowing before you rely on it:

- Snapchat memories and TikTok videos are NOT files in the ZIP. They're download
  links that expire, roughly a week for Snapchat and faster for TikTok. If your
  export has been sitting a while, that media may already be gone.
- Instagram's JSON has the text encoding mangled, so emoji and accents look like
  "cafÃ©".

(Disclosure: I maintain an open-source tool that merges these into one browsable
archive, so take the recommendation with that in mind.)`,
  },
  {
    topic: "archiving before deleting an account",
    terms: [
      "delete instagram keep photos",
      "backup social media before deleting account",
      "archive my instagram posts locally",
      "leaving twitter export archive",
    ],
    subreddits: ["DataHoarder", "privacy", "degoogle", "selfhosted"],
    maxAgeDays: 1095,
    draft: `Request the export before you delete anything — they take up to four days to
generate, and you cannot request one after the account is gone.

The part people get caught by: the download link expires in about a week, and for
Snapchat and TikTok the media inside is itself just a set of expiring links rather
than actual files. So "downloaded the ZIP" is not the same as "have my photos".
Verify the media is really in there before you delete.

(Disclosure: I wrote an open-source tool for turning those exports into a
readable archive, so I have a bias here.)`,
  },
  {
    topic: "data portability / GDPR export quality",
    terms: [
      "gdpr data export useless format",
      "article 20 data portability practice",
      "right to data portability json dump",
    ],
    subreddits: ["privacy", "gdpr", "europe"],
    maxAgeDays: 1095,
    draft: `Article 20 requires "structured, commonly used and machine-readable" — and a ZIP
of JSON satisfies all three while still being unusable in practice. Nothing in the
text requires the data to be complete, the media to be included rather than linked,
or the text encoding to be correct.

That gap is where basically every complaint about exports lives.

(Disclosure: I maintain an open-source tool in this space.)`,
  },
];

export const CROSSCHECK_LEADS: Query[] = [
  {
    topic: "AI review reliability",
    terms: [
      "ai code review false positives",
      "claude code hallucinated bug review",
      "llm code review unreliable",
      "how to trust ai code review",
    ],
    subreddits: ["ChatGPTCoding", "LocalLLaMA", "ExperiencedDevs"],
    maxAgeDays: 545,
    draft: `The thing that helped most here was cross-checking between vendors rather than
re-running the same model. Running one model twice reproduces its blind spots —
same training data, same failure modes. Two models from different labs agreeing is
a genuinely different signal.

In practice: have one write, have a different vendor's agent review the diff, and
only look closely at what both independently flag. Findings raised by exactly one
model, where others reviewed the same file and said nothing, are where the
hallucinations cluster.

(Disclosure: I got annoyed enough to write an open-source tool that automates
this, so I'm biased.)`,
  },
  {
    topic: "running multiple coding agents",
    terms: [
      "claude code and codex together",
      "run multiple ai coding agents",
      "compare claude codex gemini cli output",
    ],
    subreddits: ["ChatGPTCoding", "LocalLLaMA", "vibecoding"],
    maxAgeDays: 365,
    draft: `Worth separating two different things people mean by this: running agents in
parallel on separate tasks (isolation, which several tools do well), versus having
them actually check each other's work on the same diff.

The second one is where I got value — different labs have different blind spots, so
agreement between them is evidence in a way that one model's confidence isn't.

(Disclosure: I maintain an open-source tool for the second case.)`,
  },
];

/** Searches for people already talking about you. */
export function mentionQueries(repo: string, names: string[]): Query[] {
  return [
    {
      topic: "direct mention",
      terms: [...names, `github.com/${repo}`],
      draft:
        "Someone is talking about the project. Read the whole thread before replying,\n" +
        "thank them, and answer any question directly. If they found a bug, open the\n" +
        "issue yourself rather than asking them to.",
    },
  ];
}
