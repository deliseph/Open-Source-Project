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

Crosscheck runs several agents against the same diff independently — CLI agents you
already have, models over an API, or a mix — then reconciles what comes back:

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

Node 20+, and reviewers from at least **two different vendors**. Those can be:

- **CLI agents you already have** — Claude Code, Codex, Gemini CLI, Aider, OpenCode.
  Crosscheck runs them, so nothing extra is billed beyond what they already cost.
- **API keys**, including free tiers with no credit card. No CLI to install and
  nothing to host — see [No CLIs? Use models over HTTP](#no-clis-use-models-over-http).

You can mix the two freely. One vendor gets you findings but never a CONFIRMED
verdict, and `doctor` tells you so.

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
| `--html <file>` | write a self-contained HTML report (see below) |
| `--keep-worktree` | don't delete the author's worktree |
| `--plain` | no live office view (for CI logs) |

Crosscheck **exits 1** when vendors agree on something critical or major, so it works
as a pre-commit hook or a CI gate:

```yaml
- run: npx crosscheck review --base ${{ github.base_ref }} --plain
```

## The review as a file you can read anywhere

```bash
crosscheck review --html review.html
```

One self-contained file. No server, no hosting, no build step — open it by
double-clicking on a laptop or tapping it on a phone. The data is embedded and
the styles are inlined, so it makes **no network requests at all** (asserted in
CI, same as Archivore's archive page).

- Responsive, so it reads properly on a phone
- Follows the reader's light/dark preference
- Filter by verdict and severity
- **Save as PDF** — a permanent record of what was flagged and by whom, which
  outlives the branch and this tool

Printing always includes every finding, never whatever filter happened to be
active. A review is tens of items, so nothing is behind pagination and a
printed record can never be silently incomplete.

Attach it to a pull request, mail it to a reviewer, or keep the PDF for an
audit trail.

> Add `review.html` and `.crosscheck/` to `.gitignore` — otherwise the report
> shows up in the next diff you review.

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

## No CLIs? Use models over HTTP

Installing a CLI per vendor is the biggest barrier to getting two labs
reviewing your code. You don't have to.

**There is no server to run.** Crosscheck is a command: it makes a few requests
during a review and exits. Nothing runs when you aren't using it — no daemon, no
gateway, no 24/7 anything. You only need an API key.

```bash
export GEMINI_API_KEY=...      # free, no credit card
export GROQ_API_KEY=...        # free, no credit card
crosscheck review -r gemini-free,groq-free
```

Built-in HTTP reviewers:

| id | Model | Cost |
| --- | --- | --- |
| `gemini-free` | Gemini 2.5 Flash | Free tier |
| `groq-free` | Llama 3.3 70B | Free tier |
| `cerebras-free` | Llama 3.3 70B | Free tier |
| `mistral-free` | Mistral Large | Free tier |
| `anthropic-api` | Claude | Paid |
| `openai-api` | GPT | Paid |
| `openrouter` | Anything | Paid, one key for every lab |
| `omniroute` | Anything | Local gateway, `localhost:20128` |
| `ollama` | Local models | Free, your hardware |

Everything speaks the OpenAI chat-completions shape, so any endpoint works —
add your own in `crosscheck.json` with `"kind": "http"`.

### Free tiers train on your code

This matters more here than in most tools, because Crosscheck sends **your
source**. Several free tiers use inputs to improve their models — Mistral's
Experiment tier requires opting in, and Google's free tier permits it outside
the EEA, Switzerland and the UK, where paid terms apply to free usage too.

`crosscheck doctor` marks those endpoints. Free tiers are the right default for
open source and the wrong default for your employer's repository — for private
code, use a paid endpoint or a local model via `ollama`.

Limits and terms change often. Verify before trusting either.

### When a free tier runs out

Free quotas are where runs die: a reviewer that worked this morning returns 429
this afternoon. Give a seat a fallback chain with `|`:

```bash
crosscheck review -r "gemini-free|gemini-api, groq-free|cerebras-free"
```

Each seat tries its endpoints in order. Only quota failures (429, 402) move on
— a 500 stops, because retrying it elsewhere usually fails the same way more
slowly. An exhausted endpoint is remembered in `.crosscheck/cooldowns.json` and
skipped until its window passes, honouring `Retry-After` when the provider
sends one.

```
~ free out of quota — falling back to paid
~ fell back: free -> paid

CONFIRMED 2 vendors
  MAJOR  off-by-one: loop runs n+1 times
```

The report always says which seats fell back, so a run is never quietly
different from what you configured.

**A seat holds a vendor, not just an answer.** If fallbacks cross labs —
`gemini-free|groq-free` is Google falling back to Meta — Crosscheck warns,
because a CONFIRMED verdict may then rest on a different pair of labs than you
chose. Prefer chaining the same vendor reached another way (free tier → paid
key → gateway). If two seats both end up served by one lab, agreement is 1 and
nothing is CONFIRMED. Tested both ways.

**Nothing here acquires credentials.** Endpoints come from your config and keys
from your environment. Crosscheck will not scan for keys or create accounts:
using a key you found is unauthorised access to someone's paid account, and
farming free-tier signups is quota fraud that gets the people running it
banned. The supported way to survive a quota limit is to fall back to another
endpoint *you* hold, or to a local model that has no quota at all:

```bash
crosscheck review -r "gemini-free|ollama, groq-free|ollama"
```

### Gateways cannot fake consensus

A gateway may fall back to another provider when one is rate-limited. If
Crosscheck trusted the vendor it *asked* for, two "different vendors" agreeing
could be the same model twice — consensus would become a lie with no error.

So the vendor is derived from the model the response says **actually served**
it, never from the one requested. A substitution is reported, and two reviewers
that both fell back to the same lab produce `agreement: 1`, not CONFIRMED.
This is a tested case.

### HTTP reviewers, CLI authors

An HTTP model only sees the text it is sent, so it reviews well — the diff *is*
the input — but it cannot edit files and therefore cannot be the author.
`build` refuses an HTTP author with an explanation rather than producing an
empty diff. Reviewers can be HTTP; authors must be a CLI agent.

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
npm test        # 72 tests, no agents or API keys required
npm run typecheck
```

## License

[MIT](LICENSE).
