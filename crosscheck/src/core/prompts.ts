/**
 * Prompts.
 *
 * Two things matter here. The reviewer must return parseable JSON, and it
 * must not be told which agent wrote the code — naming the author biases a
 * reviewer toward deference or toward nitpicking, and either one destroys the
 * independence that makes cross-vendor agreement worth anything.
 */

export function authorPrompt(task: string): string {
  return `You are working in a git worktree. Complete this task, editing files directly.

TASK
${task}

Make the change. Do not commit. When you are done, briefly summarise what you
changed and why.`;
}

export function reviewPrompt(diff: string, task?: string): string {
  return `Review this diff for defects. Be specific and be sceptical.

${task ? `The change was meant to accomplish:\n${task}\n\n` : ""}DIFF
\`\`\`diff
${diff}
\`\`\`

Report only real problems in the changed code: correctness bugs, security
issues, resource leaks, race conditions, broken error handling, and behaviour
that contradicts the stated intent. Do not report formatting preferences, and
do not restate what the code does.

If the diff is fine, return an empty array. An empty array is a valid and
useful answer — do not invent problems to seem thorough.

Reply with JSON and nothing else, in exactly this shape:

[
  {
    "file": "src/example.ts",
    "line": 42,
    "severity": "critical" | "major" | "minor" | "nit",
    "title": "one line naming the defect",
    "detail": "why it is wrong and what happens when it goes wrong"
  }
]`;
}

/**
 * Asked of an author agent once reviewers have reported.
 *
 * Only confirmed findings are passed in: making an author chase single-vendor
 * findings is how you get churn from one model's hallucination.
 */
export function fixPrompt(findings: { file: string; line?: number; title: string; detail?: string }[]): string {
  const list = findings
    .map((f, i) => `${i + 1}. ${f.file}${f.line ? `:${f.line}` : ""} — ${f.title}${f.detail ? `\n   ${f.detail}` : ""}`)
    .join("\n");

  return `Independent reviewers agreed on the following problems in your change.
Fix them, editing files directly. Do not commit.

${list}

If you believe one of these is wrong, leave the code as it is and say which
one and why.`;
}
