import { describe, expect, it } from "vitest";

import { isSameIssue, merge, rank, similarity } from "../src/core/consensus.js";
import type { Finding } from "../src/core/types.js";

function finding(partial: Partial<Finding>): Finding {
  return {
    agent: "a",
    vendor: "v",
    file: "src/a.ts",
    severity: "major",
    title: "something",
    ...partial,
  };
}

describe("similarity", () => {
  it("scores identical text as 1", () => {
    expect(similarity("off by one in the loop", "off by one in the loop")).toBe(1);
  });

  it("ignores stopwords and punctuation", () => {
    expect(similarity("the retry loop is broken", "retry loop broken!")).toBe(1);
  });

  it("scores unrelated text near zero", () => {
    expect(similarity("null dereference in parser", "missing copyright header")).toBe(0);
  });
});

describe("isSameIssue", () => {
  it("never matches across different files", () => {
    expect(
      isSameIssue(
        finding({ file: "a.ts", line: 10, title: "off by one" }),
        finding({ file: "b.ts", line: 10, title: "off by one" }),
      ),
    ).toBe(false);
  });

  it("matches nearby lines described differently", () => {
    // Reviewers routinely disagree by a line or two about where a bug lives.
    expect(
      isSameIssue(
        finding({ line: 10, title: "off-by-one error in retry loop" }),
        finding({ line: 12, title: "retry loop iterates one time too many" }),
      ),
    ).toBe(true);
  });

  it("matches on wording alone when lines are missing", () => {
    expect(
      isSameIssue(
        finding({ title: "unchecked null dereference in parser" }),
        finding({ title: "parser dereferences null unchecked" }),
      ),
    ).toBe(true);
  });

  it("matches findings on the exact same line even with no shared words", () => {
    // Three real reviewers describing one logged-credential bug. Requiring
    // shared vocabulary here reported genuine consensus as three separate
    // single-vendor hunches.
    expect(
      isSameIssue(
        finding({ line: 8, title: "auth token written to logs" }),
        finding({ line: 8, title: "secret logged in plaintext" }),
      ),
    ).toBe(true);
    expect(
      isSameIssue(
        finding({ line: 8, title: "secret logged in plaintext" }),
        finding({ line: 8, title: "token value printed to console" }),
      ),
    ).toBe(true);
  });

  it("still separates same-line findings in different files", () => {
    expect(
      isSameIssue(
        finding({ file: "a.ts", line: 8, title: "auth token written to logs" }),
        finding({ file: "b.ts", line: 8, title: "secret logged in plaintext" }),
      ),
    ).toBe(false);
  });

  it("keeps genuinely different issues in the same file apart", () => {
    expect(
      isSameIssue(
        finding({ line: 10, title: "off by one in retry loop" }),
        finding({ line: 90, title: "password logged in plaintext" }),
      ),
    ).toBe(false);
  });
});

describe("merge", () => {
  it("counts distinct vendors, not agents", () => {
    // Two Anthropic agents agreeing is repetition, not corroboration.
    const [merged] = merge([
      finding({ agent: "claude", vendor: "anthropic", line: 10, title: "off by one in loop" }),
      finding({ agent: "claude-2", vendor: "anthropic", line: 10, title: "off by one in loop" }),
    ]);

    expect(merged?.agreement).toBe(1);
    expect(merged?.raisedBy).toEqual(["claude", "claude-2"]);
  });

  it("counts two vendors as agreement", () => {
    const [merged] = merge([
      finding({ agent: "claude", vendor: "anthropic", line: 10, title: "off by one in loop" }),
      finding({ agent: "codex", vendor: "openai", line: 11, title: "loop runs one extra time" }),
    ]);
    expect(merged?.agreement).toBe(2);
  });

  it("keeps the most severe rating and the fullest explanation", () => {
    const [merged] = merge([
      finding({ vendor: "a", line: 10, title: "off by one in loop", severity: "minor", detail: "short" }),
      finding({
        vendor: "b",
        line: 10,
        title: "off by one in loop",
        severity: "critical",
        detail: "a considerably longer explanation of the failure",
      }),
    ]);

    expect(merged?.severity).toBe("critical");
    expect(merged?.detail).toBe("a considerably longer explanation of the failure");
  });

  it("borrows a line number from whichever reviewer supplied one", () => {
    const [merged] = merge([
      finding({ vendor: "a", title: "null dereference in the parser" }),
      finding({ vendor: "b", line: 55, title: "parser null dereference" }),
    ]);
    expect(merged?.line).toBe(55);
  });

  it("leaves unrelated findings as separate groups", () => {
    expect(
      merge([
        finding({ line: 10, title: "off by one in loop" }),
        finding({ line: 90, title: "credentials written to the log" }),
      ]),
    ).toHaveLength(2);
  });
});

describe("rank", () => {
  const reviewed = (...vendors: string[]) =>
    new Map(vendors.map((v) => [v, new Set(["src/a.ts"])]));

  it("marks cross-vendor agreement as confirmed and puts it first", () => {
    const ranked = rank(
      [
        finding({ vendor: "anthropic", line: 90, title: "nit about naming", severity: "nit" }),
        finding({ vendor: "anthropic", line: 10, title: "off by one in loop", severity: "major" }),
        finding({ vendor: "openai", line: 10, title: "loop runs one extra time", severity: "major" }),
      ],
      reviewed("anthropic", "openai"),
    );

    expect(ranked[0]?.verdict).toBe("confirmed");
    expect(ranked[0]?.agreement).toBe(2);
    expect(ranked[1]?.verdict).toBe("single");
  });

  it("disputes a lone finding when two other vendors reviewed that file silently", () => {
    const ranked = rank(
      [finding({ vendor: "anthropic", line: 10, title: "off by one in loop" })],
      reviewed("anthropic", "openai", "google"),
    );

    expect(ranked[0]?.verdict).toBe("disputed");
    expect(ranked[0]?.disputedBy).toEqual(["openai", "google"]);
  });

  it("does not dispute when only one other vendor was silent", () => {
    const ranked = rank(
      [finding({ vendor: "anthropic", line: 10, title: "off by one in loop" })],
      reviewed("anthropic", "openai"),
    );
    expect(ranked[0]?.verdict).toBe("single");
  });

  it("does not dispute based on a vendor that never reviewed that file", () => {
    const files = new Map([
      ["anthropic", new Set(["src/a.ts"])],
      ["openai", new Set(["src/other.ts"])],
      ["google", new Set(["src/other.ts"])],
    ]);
    const ranked = rank([finding({ vendor: "anthropic", line: 10, title: "off by one" })], files);
    expect(ranked[0]?.verdict).toBe("single");
  });

  it("orders by severity within the same verdict", () => {
    const ranked = rank(
      [
        finding({ vendor: "a", file: "x.ts", title: "minor thing here", severity: "minor" }),
        finding({ vendor: "a", file: "y.ts", title: "critical thing here", severity: "critical" }),
      ],
      reviewed("a"),
    );
    expect(ranked[0]?.severity).toBe("critical");
  });
});
