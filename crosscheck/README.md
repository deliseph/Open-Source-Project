<div align="center">

# Crosscheck

**An office for your AI coding agents.**

Claude Code writes it. Codex reviews it. Gemini breaks the tie.
You only read the findings two different labs independently agreed on.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

</div>

---

## Why

One model reviewing your diff produces a mix of real bugs and confident nonsense,
and you can't tell which is which without reading all of it. Running the same model
twice doesn't help — it has the same blind spots both times.

Two models **from different labs** agreeing is a genuinely different signal. They don't
share training data, and they don't share failure modes.

Crosscheck runs the CLI agents you already have installed against the same diff,
independently, then reconciles what comes back:

```
2 findings · 1 confirmed across vendors

CONFIRMED 2 vendors
  CRITICAL  off-by-one: loop runs n+1 times
  client.js:2
  The condition uses <= so retry(3) attempts four times, one more than requested.

DISPUTED  openai, google saw nothing here
  MINOR     first retry has zero delay
  client.js:4
  delay * i is 0 on the first iteration, so the initial retry is immediate.
```

The first one is worth your time. The second is one model's hunch that two others
looked at and didn't share — which is exactly where a lone model tends to invent things.

## Install

```bash
npm install -g crosscheck
crosscheck doctor        # which agents do you have?
```

Node 20+, and at least two coding agents **from different vendors**. Crosscheck runs
them; it never calls a model API itself, so there are no keys to configure and no
tokens billed beyond what your agents already cost you.

## Use

```bash
# Review what you've just written, before you commit
crosscheck review

# Review a branch the way a PR would see it
crosscheck review --base main

# One agent writes it, the others review it
crosscheck build "add exponential backoff to the retry client" -a claude -r codex,gemini
```

`build` runs the author in a **throwaway git worktree**, so a session can never touch
the checkout you're sitting in. Add `--keep-worktree` to inspect or merge the result.

| Option | |
| --- | --- |
| `-r, --reviewers <ids>` | e.g. `codex,gemini` |
| `-a, --author <id>` | who writes the code (`build` only) |
| `--base <ref>` | review against a ref instead of the working tree |
| `--json <file>` | write the full report as JSON |
| `--keep-worktree` | don't delete the author's worktree |
| `--plain` | no live office view (for CI logs) |

Crosscheck **exits 1** when vendors agree on something critical or major, so it works
as a pre-commit hook or a CI gate:

```yaml
- run: npx crosscheck review --base ${{ github.base_ref }} --plain
```

## How the verdicts work

This is the whole product, so it's worth being precise.

| Verdict | Meaning |
| --- | --- |
| **CONFIRMED** | Raised independently by agents from **2+ different vendors** |
| **SINGLE** | Only one vendor raised it. Might be real, might not |
| **DISPUTED** | One vendor raised it, and **2+ other vendors** reviewed that same file without mentioning it |

Three rules make those labels mean something:

1. **Agreement is counted per vendor, never per agent.** Running Claude twice gives you
   `agreement: 1`. Two agents from the same lab is repetition, not corroboration, and
   the tool says so out loud if you configure it that way.
2. **Reviewers never see each other's output.** They run concurrently and independently.
   Agreement is only evidence if it wasn't coordinated.
3. **Reviewers aren't told who wrote the code.** Naming the author biases a reviewer
   toward deference or toward nitpicking, and either one destroys the signal.

Findings are matched across reviewers by file, then by line proximity (±3 lines) and
description overlap — because two models describing the same bug rarely word it the
same way or agree on the exact line.

## Configure

`crosscheck init` writes a starting point:

```json
{
  "author": "claude",
  "reviewers": ["codex", "gemini"],
  "agents": []
}
```

Built in: `claude`, `codex`, `gemini`, `aider`, `opencode`.

**Agents are declarative**, so adding one is config, not code — and no release is
needed for a CLI that came out this morning:

```json
{
  "reviewers": ["codex", "mycorp"],
  "agents": [
    {
      "id": "mycorp",
      "name": "Internal Agent",
      "vendor": "mycorp",
      "command": "mycorp-cli",
      "args": ["review", "--quiet", "{{prompt}}"],
      "timeout": 600
    }
  ]
}
```

`{{prompt}}` is replaced with the prompt. **Omit it and the prompt goes to stdin
instead**, which avoids the OS argument-length limit on a large diff.

Overriding a built-in works the same way — same `id`, only the fields you want to
change. CLI flags drift, and `crosscheck doctor` prints the exact command that will
run, so a broken default is a one-line fix rather than a blocked afternoon.

## Use it as a library

The consensus layer is useful on its own. If you already have findings from several
models, `rank` reconciles them with none of the process machinery:

```ts
import { rank } from "crosscheck";

const findings = rank(allFindings, reviewedFilesByVendor);
// → sorted, deduplicated, each labelled confirmed / single / disputed
```

`review()` and `buildAndReview()` are exported too, with progress events for building
your own UI on top.

## Honest limitations

- **You need agents from two different vendors.** With one, nothing can ever be
  CONFIRMED, and the tool tells you rather than quietly degrading.
- **Consensus is evidence, not proof.** Two models can be wrong together, especially
  on domain logic they have no context for. It reorders your attention; it doesn't
  replace your judgement.
- **Big diffs strain reviewer context.** Crosscheck warns past roughly 100k tokens.
  Review narrower ranges.
- **Agent CLI flags change.** That's why every spec is overridable and `doctor` shows
  you the command.
- **It costs what your agents cost.** Three reviewers is three agent invocations.

## Contributing

The most useful contribution is an agent spec for a CLI that isn't covered — that's a
JSON entry and a README row, no code. After that: better cross-reviewer finding
matching, which is where the remaining accuracy lives.

Tests use fake agent subprocesses, so you can work on the orchestration without
installing Claude Code, Codex or Gemini:

```bash
npm install
npm test        # 42 tests, no agents required
npm run typecheck
```

## License

[MIT](LICENSE).
