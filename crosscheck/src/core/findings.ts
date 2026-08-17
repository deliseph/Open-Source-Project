import type { Finding, Severity } from "./types.js";

/**
 * Getting structured findings back out of an agent's answer.
 *
 * Agents are asked for JSON and mostly comply, but "mostly" covers a lot:
 * a fenced block with commentary either side, two blocks where one is an
 * example, a bare array, or JSON with a friendly paragraph glued to the front.
 * Being strict here means silently losing a real review, so this tries hard.
 */

const SEVERITIES: Severity[] = ["critical", "major", "minor", "nit"];

export function normaliseSeverity(value: unknown): Severity {
  const text = String(value ?? "").toLowerCase().trim();
  if (SEVERITIES.includes(text as Severity)) return text as Severity;
  // Map the words models reach for when they ignore the enum.
  if (/^(blocker|severe|high|error|bug)$/.test(text)) return "critical";
  if (/^(medium|moderate|warn|warning|important)$/.test(text)) return "major";
  if (/^(low|suggestion|style|info)$/.test(text)) return "minor";
  if (/^(nitpick|trivial|polish)$/.test(text)) return "nit";
  return "minor";
}

/**
 * Pulls every plausible JSON value out of a blob of text.
 *
 * Scans for balanced brackets rather than regex-matching, so JSON containing
 * braces inside strings survives. Returns candidates longest-first, because
 * the biggest valid parse is almost always the real payload rather than an
 * inline example.
 */
export function extractJsonCandidates(text: string): unknown[] {
  const found: { value: unknown; length: number }[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char !== "{" && char !== "[") continue;

    const close = char === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = i; j < text.length; j++) {
      const c = text[j]!;

      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\" && inString) {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (c === char) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          const slice = text.slice(i, j + 1);
          try {
            found.push({ value: JSON.parse(slice), length: slice.length });
            // Skip past this value; nested objects are already covered by it.
            i = j;
          } catch {
            // Not valid JSON — keep scanning from the next character.
          }
          break;
        }
      }
    }
  }

  return found.sort((a, b) => b.length - a.length).map((f) => f.value);
}

/** Finds the array of findings inside whatever shape the agent returned. */
function toRecordArray(value: unknown): Record<string, unknown>[] | undefined {
  if (Array.isArray(value)) {
    return value.every((v) => v && typeof v === "object")
      ? (value as Record<string, unknown>[])
      : undefined;
  }
  if (value && typeof value === "object") {
    // Agents commonly wrap it: { findings: [...] }, { issues: [...] }.
    for (const key of ["findings", "issues", "problems", "results", "comments"]) {
      const nested = (value as Record<string, unknown>)[key];
      if (Array.isArray(nested)) return toRecordArray(nested);
    }
  }
  return undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return undefined;
}

/**
 * Turns one agent's raw answer into findings.
 *
 * Returns an empty array when the agent found nothing *or* produced nothing
 * parseable — `hadJson` distinguishes the two, because "clean review" and
 * "the agent rambled" must not look the same to the user.
 */
export function parseFindings(
  raw: string,
  agent: string,
  vendor: string,
): { findings: Finding[]; hadJson: boolean } {
  for (const candidate of extractJsonCandidates(raw)) {
    const records = toRecordArray(candidate);
    if (!records) continue;

    const findings: Finding[] = [];
    for (const record of records) {
      const title = firstString(record, ["title", "summary", "message", "issue", "description"]);
      const file = firstString(record, ["file", "path", "filename", "filePath"]);
      if (!title || !file) continue;

      const line = firstNumber(record, ["line", "lineNumber", "startLine", "start_line"]);
      const detail = firstString(record, ["detail", "details", "explanation", "reason", "body"]);

      findings.push({
        agent,
        vendor,
        file: file.replace(/^\.\//, ""),
        ...(line != null ? { line } : {}),
        severity: normaliseSeverity(record["severity"] ?? record["level"] ?? record["priority"]),
        title,
        ...(detail ? { detail } : {}),
      });
    }

    // An empty array is a legitimate "looks good to me" — accept it and stop.
    if (findings.length > 0 || records.length === 0) {
      return { findings, hadJson: true };
    }
  }

  return { findings: [], hadJson: false };
}
