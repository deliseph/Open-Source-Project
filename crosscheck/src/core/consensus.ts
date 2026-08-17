import type { ConsensusFinding, Finding, RankedFinding, Severity, Verdict } from "./types.js";

/**
 * Cross-vendor consensus — the reason this tool exists.
 *
 * A single model reviewing a diff produces a mix of real bugs and confident
 * nonsense, and you can't tell which is which without reading everything. Two
 * models from *different labs* agreeing is a much stronger signal, because
 * they don't share training data or failure modes.
 *
 * So agreement is counted per **vendor**, never per agent. Running Claude
 * twice is repetition, not corroboration, and must not promote a finding.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "in", "on", "at", "to", "for",
  "of", "and", "or", "but", "if", "then", "this", "that", "these", "those", "it", "its",
  "will", "would", "should", "could", "may", "might", "can", "not", "no", "when", "which",
]);

/** Content words only, so wording differences don't defeat matching. */
export function tokenise(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/** Jaccard overlap of two strings' content words, 0–1. */
export function similarity(a: string, b: string): number {
  const left = tokenise(a);
  const right = tokenise(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared);
}

/** How close two line numbers must be to count as the same spot. */
const LINE_WINDOW = 3;
const TITLE_THRESHOLD = 0.4;

/**
 * Are these two findings about the same problem?
 *
 * Same file is required. After that, either the lines nearly coincide *and*
 * the descriptions are loosely related, or the descriptions match strongly
 * enough to carry it alone — reviewers often disagree by a few lines about
 * where a bug lives, and often omit the line entirely.
 */
export function isSameIssue(a: Finding, b: Finding): boolean {
  if (a.file !== b.file) return false;

  const overlap = similarity(a.title, b.title);
  const bothLined = a.line != null && b.line != null;

  if (bothLined && Math.abs(a.line! - b.line!) <= LINE_WINDOW) {
    return overlap >= TITLE_THRESHOLD / 2;
  }
  return overlap >= TITLE_THRESHOLD;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, major: 1, minor: 2, nit: 3 };

/** Keeps the most alarming severity any reviewer assigned. */
function worst(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

/** Groups equivalent findings into one, tracking which vendors raised it. */
export function merge(findings: Finding[]): ConsensusFinding[] {
  const groups: { representative: Finding; members: Finding[] }[] = [];

  for (const finding of findings) {
    const group = groups.find((g) => g.members.some((m) => isSameIssue(m, finding)));
    if (group) group.members.push(finding);
    else groups.push({ representative: finding, members: [finding] });
  }

  return groups.map(({ representative, members }) => {
    const vendors = new Set(members.map((m) => m.vendor));
    const agents = [...new Set(members.map((m) => m.agent))];

    // Prefer the longest explanation — usually the most useful one.
    const detail = members
      .map((m) => m.detail)
      .filter((d): d is string => Boolean(d))
      .sort((a, b) => b.length - a.length)[0];

    return {
      ...representative,
      severity: members.map((m) => m.severity).reduce(worst),
      ...(detail ? { detail } : {}),
      // A line from any reviewer beats none.
      ...(representative.line == null
        ? { line: members.find((m) => m.line != null)?.line }
        : {}),
      agreement: vendors.size,
      raisedBy: agents,
    };
  });
}

/**
 * Labels each finding and sorts the list so the useful things are at the top.
 *
 * `disputed` means one vendor flagged it while at least two others reviewed
 * that same file and said nothing there — weak evidence against, but worth
 * showing, because it's exactly where a lone model tends to hallucinate.
 */
export function rank(
  findings: Finding[],
  reviewedFilesByVendor: Map<string, Set<string>>,
): RankedFinding[] {
  const merged = merge(findings);

  const ranked: RankedFinding[] = merged.map((finding) => {
    let verdict: Verdict = finding.agreement >= 2 ? "confirmed" : "single";
    let disputedBy: string[] | undefined;

    if (verdict === "single") {
      const silent = [...reviewedFilesByVendor.entries()]
        .filter(([vendor, files]) => vendor !== finding.vendor && files.has(finding.file))
        .map(([vendor]) => vendor);

      if (silent.length >= 2) {
        verdict = "disputed";
        disputedBy = silent;
      }
    }

    return { ...finding, verdict, ...(disputedBy ? { disputedBy } : {}) };
  });

  const VERDICT_RANK: Record<Verdict, number> = { confirmed: 0, single: 1, disputed: 2 };

  return ranked.sort(
    (a, b) =>
      VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.agreement - a.agreement ||
      a.file.localeCompare(b.file),
  );
}
