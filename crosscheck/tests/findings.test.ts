import { describe, expect, it } from "vitest";

import { extractJsonCandidates, normaliseSeverity, parseFindings } from "../src/core/findings.js";

describe("extractJsonCandidates", () => {
  it("finds JSON inside surrounding prose", () => {
    const text = `Sure! Here's my review:

\`\`\`json
[{"file": "a.ts", "title": "bug"}]
\`\`\`

Let me know if you want more detail.`;
    expect(extractJsonCandidates(text)[0]).toEqual([{ file: "a.ts", title: "bug" }]);
  });

  it("is not fooled by braces inside strings", () => {
    const text = `[{"file": "a.ts", "title": "unbalanced { brace in the text"}]`;
    expect(extractJsonCandidates(text)[0]).toEqual([
      { file: "a.ts", title: "unbalanced { brace in the text" },
    ]);
  });

  it("handles escaped quotes inside strings", () => {
    const text = `[{"file":"a.ts","title":"the \\"clever\\" cast"}]`;
    expect(extractJsonCandidates(text)[0]).toEqual([{ file: "a.ts", title: 'the "clever" cast' }]);
  });

  it("returns the largest valid value first", () => {
    // A short inline example followed by the real payload.
    const text = `e.g. {"a":1} but here is the review: [{"file":"a.ts","title":"a real finding here"}]`;
    expect(Array.isArray(extractJsonCandidates(text)[0])).toBe(true);
  });

  it("returns nothing for text with no JSON", () => {
    expect(extractJsonCandidates("I could not review this diff.")).toEqual([]);
  });
});

describe("normaliseSeverity", () => {
  it("passes through the documented values", () => {
    expect(normaliseSeverity("critical")).toBe("critical");
    expect(normaliseSeverity("NIT")).toBe("nit");
  });

  it("maps the words models use instead", () => {
    expect(normaliseSeverity("blocker")).toBe("critical");
    expect(normaliseSeverity("high")).toBe("critical");
    expect(normaliseSeverity("warning")).toBe("major");
    expect(normaliseSeverity("suggestion")).toBe("minor");
    expect(normaliseSeverity("nitpick")).toBe("nit");
  });

  it("falls back to minor rather than dropping the finding", () => {
    expect(normaliseSeverity(undefined)).toBe("minor");
    expect(normaliseSeverity("spicy")).toBe("minor");
  });
});

describe("parseFindings", () => {
  it("reads a plain array", () => {
    const raw = `[{"file":"src/a.ts","line":10,"severity":"critical","title":"off by one","detail":"loops one past the end"}]`;
    const { findings, hadJson } = parseFindings(raw, "codex", "openai");

    expect(hadJson).toBe(true);
    expect(findings).toEqual([
      {
        agent: "codex",
        vendor: "openai",
        file: "src/a.ts",
        line: 10,
        severity: "critical",
        title: "off by one",
        detail: "loops one past the end",
      },
    ]);
  });

  it("unwraps the object shapes agents wrap results in", () => {
    for (const key of ["findings", "issues", "results"]) {
      const raw = `{"${key}": [{"file":"a.ts","title":"x"}]}`;
      expect(parseFindings(raw, "a", "v").findings).toHaveLength(1);
    }
  });

  it("accepts alternative key names", () => {
    const raw = `[{"path":"a.ts","lineNumber":"7","message":"leak","level":"high","explanation":"why"}]`;
    const [finding] = parseFindings(raw, "a", "v").findings;

    expect(finding).toMatchObject({
      file: "a.ts",
      line: 7,
      title: "leak",
      severity: "critical",
      detail: "why",
    });
  });

  it("distinguishes a clean review from an unparseable one", () => {
    const clean = parseFindings("[]", "a", "v");
    expect(clean.hadJson).toBe(true);
    expect(clean.findings).toEqual([]);

    const rambling = parseFindings("The diff looks fine to me overall.", "a", "v");
    expect(rambling.hadJson).toBe(false);
    expect(rambling.findings).toEqual([]);
  });

  it("drops records missing a file or title rather than inventing them", () => {
    const raw = `[{"file":"a.ts"},{"title":"no file"},{"file":"b.ts","title":"good"}]`;
    const { findings } = parseFindings(raw, "a", "v");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("b.ts");
  });

  it("normalises leading ./ in paths so reviewers match", () => {
    expect(parseFindings(`[{"file":"./src/a.ts","title":"x"}]`, "a", "v").findings[0]?.file).toBe(
      "src/a.ts",
    );
  });
});
