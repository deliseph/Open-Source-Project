import { describe, expect, it } from "vitest";

import { dedupeLeads, relevance, render, score, toLeads } from "../src/digest.js";
import * as hn from "../src/sources/hn.js";
import * as reddit from "../src/sources/reddit.js";
import type { Hit, Query } from "../src/types.js";

function hit(partial: Partial<Hit>): Hit {
  return {
    id: "x1",
    source: "reddit",
    title: "some thread",
    url: "https://example.com/1",
    createdAt: new Date(Date.now() - 5 * 86_400_000),
    ...partial,
  };
}

const QUERY: Query = {
  topic: "mangled export encoding",
  terms: ["instagram export weird characters", "instagram data download emoji broken"],
  draft: "Here is the explanation.",
};

describe("score", () => {
  it("rates a title match above a body-only match", () => {
    const inTitle = score(hit({ title: "instagram export weird characters help" }), QUERY.terms);
    const inBody = score(
      hit({ title: "unrelated question", text: "instagram export weird characters" }),
      QUERY.terms,
    );

    expect(inTitle).toBeGreaterThan(inBody);
    expect(inBody).toBeGreaterThan(0);
  });

  it("returns zero for an unrelated thread", () => {
    expect(score(hit({ title: "best mechanical keyboard 2026" }), QUERY.terms)).toBe(0);
  });
});

describe("relevance", () => {
  it("boosts questions nobody has answered yet", () => {
    const base = { title: "instagram export weird characters", createdAt: new Date() };
    const unanswered = relevance(hit({ ...base, comments: 0 }), QUERY.terms);
    const answered = relevance(hit({ ...base, comments: 12 }), QUERY.terms);

    expect(unanswered).toBeGreaterThan(answered);
  });

  it("heavily discounts huge threads where a reply would be invisible", () => {
    const base = { title: "instagram export weird characters", createdAt: new Date() };
    expect(relevance(hit({ ...base, comments: 400 }), QUERY.terms)).toBeLessThan(
      relevance(hit({ ...base, comments: 5 }), QUERY.terms),
    );
  });

  it("discounts listicles and megathreads, which are not places to add a tool", () => {
    const normal = relevance(
      hit({ title: "instagram export weird characters", comments: 3 }),
      QUERY.terms,
    );
    const promo = relevance(
      hit({ title: "Best 10 instagram export weird characters tools", comments: 3 }),
      QUERY.terms,
    );

    expect(promo).toBeLessThan(normal * 0.5);
  });
});

describe("toLeads", () => {
  it("keeps only hits above the threshold, best first", () => {
    const leads = toLeads(
      [
        hit({ id: "a", title: "instagram export weird characters" }),
        hit({ id: "b", title: "what laptop should I buy" }),
        hit({ id: "c", title: "instagram export weird characters in captions" }),
      ],
      QUERY,
    );

    expect(leads.map((l) => l.hit.id)).not.toContain("b");
    expect(leads[0]!.relevance).toBeGreaterThanOrEqual(leads[leads.length - 1]!.relevance);
    expect(leads[0]!.draft).toBe(QUERY.draft);
  });

  it("de-duplicates repeated hits from overlapping search terms", () => {
    const same = hit({ id: "dup", title: "instagram export weird characters" });
    expect(toLeads([same, same, same], QUERY)).toHaveLength(1);
  });
});

describe("dedupeLeads", () => {
  it("shows a thread once, under its best-fitting topic", () => {
    const shared = hit({ id: "same", title: "instagram export weird characters" });
    const other: Query = { topic: "other topic", terms: ["instagram export"], draft: "different draft" };

    const merged = dedupeLeads([...toLeads([shared], QUERY), ...toLeads([shared], other)]);

    expect(merged).toHaveLength(1);
    // The more specific query matches better, so its draft is the one kept.
    expect(merged[0]!.topic).toBe(QUERY.topic);
    expect(merged[0]!.draft).toBe(QUERY.draft);
  });

  it("leaves distinct threads alone", () => {
    const leads = toLeads(
      [
        hit({ id: "a", title: "instagram export weird characters" }),
        hit({ id: "b", title: "instagram data download emoji broken" }),
      ],
      QUERY,
    );
    expect(dedupeLeads(leads)).toHaveLength(2);
  });
});

describe("render", () => {
  it("says so plainly when there is nothing worth doing", () => {
    const out = render([], "Leads");
    expect(out).toContain("Nothing worth replying to");
    expect(out).toContain("normal result");
  });

  it("puts the reply guidance above the drafts, not below", () => {
    const leads = toLeads([hit({ title: "instagram export weird characters" })], QUERY);
    const out = render(leads, "Leads");

    expect(out.indexOf("Read the whole thread")).toBeLessThan(out.indexOf("Draft reply"));
    expect(out).toContain("disclose that you wrote the tool");
    expect(out).toContain("edit before sending");
  });
});

describe("source parsing", () => {
  it("reads Algolia hits and links to the discussion, not the story URL", () => {
    const hits = hn.toHits({
      hits: [
        {
          objectID: "40123456",
          title: "Instagram mangles every emoji in your export",
          url: "https://example.com/post",
          author: "someone",
          created_at: new Date().toISOString(),
          points: 42,
          num_comments: 7,
        },
      ],
    } as never);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.url).toBe("https://news.ycombinator.com/item?id=40123456");
    expect(hits[0]!.points).toBe(42);
  });

  it("strips the HTML Algolia returns in comment bodies", () => {
    expect(hn.stripHtml("<p>it&#x27;s <i>broken</i> &amp; annoying</p>")).toBe(
      "it's broken & annoying",
    );
  });

  it("reads Reddit listings and skips NSFW threads", () => {
    const hits = reddit.toHits({
      data: {
        children: [
          {
            kind: "t3",
            data: {
              id: "abc",
              title: "how do I read my instagram export",
              permalink: "/r/DataHoarder/comments/abc/x/",
              subreddit: "DataHoarder",
              created_utc: Math.floor(Date.now() / 1000),
              num_comments: 3,
            },
          },
          {
            kind: "t3",
            data: {
              id: "nsfw",
              title: "something",
              permalink: "/r/x/comments/nsfw/y/",
              created_utc: Math.floor(Date.now() / 1000),
              over_18: true,
            },
          },
        ],
      },
    } as never);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.context).toBe("r/DataHoarder");
    expect(hits[0]!.url).toBe("https://www.reddit.com/r/DataHoarder/comments/abc/x/");
  });
});
