import type { AgentSpec, RankedFinding, SessionReport } from "../core/types.js";

/**
 * The office view.
 *
 * A live picture of who is working on what, drawn with plain ANSI so there is
 * no TUI dependency. Agents sit at desks; you watch the work move between
 * them. It degrades to plain lines when stdout isn't a terminal, so piping to
 * a file or CI log stays readable.
 */

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  grey: "\x1b[90m",
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** One colour per vendor, so you can tell the labs apart at a glance. */
const VENDOR_COLOUR: Record<string, string> = {
  anthropic: C.magenta,
  openai: C.green,
  google: C.blue,
  aider: C.yellow,
  opencode: C.cyan,
};

type DeskState = "waiting" | "working" | "done" | "failed";

interface Desk {
  spec: AgentSpec;
  role: "author" | "reviewer";
  state: DeskState;
  detail: string;
  startedAt?: number;
}

const DESK_WIDTH = 20;

function pad(text: string, width: number): string {
  // Measured on the visible string; nothing here contains ANSI yet.
  return text.length > width ? text.slice(0, width - 1) + "…" : text.padEnd(width);
}

function elapsed(from: number): string {
  const s = Math.floor((Date.now() - from) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

export class Office {
  #desks: Desk[] = [];
  #frame = 0;
  #lines = 0;
  #timer: NodeJS.Timeout | undefined;
  #live: boolean;
  #task: string;

  constructor(task: string, live = process.stdout.isTTY === true) {
    this.#task = task;
    this.#live = live;
  }

  add(spec: AgentSpec, role: "author" | "reviewer"): void {
    this.#desks.push({ spec, role, state: "waiting", detail: "waiting" });
  }

  start(): void {
    if (!this.#live) {
      process.stdout.write(`\ncrosscheck — ${this.#task}\n\n`);
      return;
    }
    process.stdout.write("\x1b[?25l"); // hide cursor
    this.#timer = setInterval(() => this.#render(), 100);
    this.#timer.unref();
  }

  update(id: string, state: DeskState, detail: string): void {
    const desk = this.#desks.find((d) => d.spec.id === id);
    if (!desk) return;

    desk.state = state;
    desk.detail = detail;
    if (state === "working" && !desk.startedAt) desk.startedAt = Date.now();

    if (!this.#live) {
      const mark = state === "done" ? "✓" : state === "failed" ? "✗" : "•";
      process.stdout.write(`  ${mark} ${desk.spec.name}: ${detail}\n`);
    }
  }

  stop(): void {
    if (!this.#live) return;
    if (this.#timer) clearInterval(this.#timer);
    this.#render();
    process.stdout.write("\x1b[?25h"); // show cursor
    process.stdout.write("\n");
  }

  #render(): void {
    this.#frame++;
    const out: string[] = [];

    out.push(`${C.bold}crosscheck${C.reset} ${C.grey}${this.#task}${C.reset}`);
    out.push("");

    // Desks laid out side by side, wrapping to fit the terminal.
    const perRow = Math.max(1, Math.floor((process.stdout.columns || 80) / (DESK_WIDTH + 3)));

    for (let i = 0; i < this.#desks.length; i += perRow) {
      const row = this.#desks.slice(i, i + perRow);
      const top: string[] = [];
      const name: string[] = [];
      const who: string[] = [];
      const status: string[] = [];
      const bottom: string[] = [];

      for (const desk of row) {
        const colour = VENDOR_COLOUR[desk.spec.vendor] ?? C.cyan;
        const bar = "─".repeat(DESK_WIDTH);

        top.push(`${colour}┌${bar}┐${C.reset}`);
        name.push(`${colour}│${C.reset}${C.bold}${pad(" " + desk.spec.name, DESK_WIDTH)}${C.reset}${colour}│${C.reset}`);
        who.push(
          `${colour}│${C.reset}${C.grey}${pad(` ${desk.spec.vendor} · ${desk.role}`, DESK_WIDTH)}${C.reset}${colour}│${C.reset}`,
        );

        const mark =
          desk.state === "working"
            ? `${C.yellow}${SPINNER[this.#frame % SPINNER.length]}${C.reset}`
            : desk.state === "done"
              ? `${C.green}✓${C.reset}`
              : desk.state === "failed"
                ? `${C.red}✗${C.reset}`
                : `${C.grey}·${C.reset}`;

        const time = desk.startedAt && desk.state === "working" ? ` ${elapsed(desk.startedAt)}` : "";
        status.push(
          `${colour}│${C.reset} ${mark} ${pad(desk.detail + time, DESK_WIDTH - 3)}${colour}│${C.reset}`,
        );
        bottom.push(`${colour}└${bar}┘${C.reset}`);
      }

      out.push(top.join(" "), name.join(" "), who.join(" "), status.join(" "), bottom.join(" "), "");
    }

    // Redraw in place: jump back over what we drew last time.
    if (this.#lines > 0) process.stdout.write(`\x1b[${this.#lines}A`);
    process.stdout.write(out.map((l) => `\x1b[2K${l}`).join("\n") + "\n");
    this.#lines = out.length;
  }
}

const SEVERITY_COLOUR: Record<string, string> = {
  critical: C.red,
  major: C.yellow,
  minor: C.blue,
  nit: C.grey,
};

function verdictLabel(finding: RankedFinding): string {
  if (finding.verdict === "confirmed") {
    return `${C.green}${C.bold}CONFIRMED${C.reset} ${C.grey}${finding.agreement} vendors${C.reset}`;
  }
  if (finding.verdict === "disputed") {
    return `${C.grey}DISPUTED  ${finding.disputedBy?.join(", ")} saw nothing here${C.reset}`;
  }
  return `${C.yellow}SINGLE${C.reset}    ${C.grey}only ${finding.raisedBy.join(", ")}${C.reset}`;
}

/** Prints the reconciled findings, most trustworthy first. */
export function printReport(report: SessionReport): void {
  const out = process.stdout;

  const failed = report.reviews.filter((r) => !r.ok);
  for (const run of failed) {
    out.write(`${C.red}✗${C.reset} ${run.agent}: ${run.error}\n`);
  }
  if (failed.length) out.write("\n");

  if (report.fellBack?.length) {
    for (const chain of report.fellBack) {
      out.write(`${C.yellow}~${C.reset} ${C.grey}fell back: ${chain}${C.reset}\n`);
    }
    out.write("\n");
  }

  if (report.vendorsHeard.length < 2) {
    out.write(
      `${C.yellow}!${C.reset} Only ${report.vendorsHeard.length || "no"} vendor${
        report.vendorsHeard.length === 1 ? "" : "s"
      } reviewed this. ` + `Cross-vendor agreement needs at least two different labs.\n\n`,
    );
  }

  if (report.findings.length === 0) {
    out.write(`${C.green}Nothing found.${C.reset} `);
    out.write(`${C.grey}${report.vendorsHeard.join(", ") || "no reviewers"}\n${C.reset}`);
    return;
  }

  const confirmed = report.findings.filter((f) => f.verdict === "confirmed").length;
  out.write(
    `${C.bold}${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}${C.reset}` +
      ` ${C.grey}·${C.reset} ${C.green}${confirmed} confirmed across vendors${C.reset}\n\n`,
  );

  for (const finding of report.findings) {
    const colour = SEVERITY_COLOUR[finding.severity] ?? C.reset;
    out.write(`${verdictLabel(finding)}\n`);
    out.write(
      `  ${colour}${finding.severity.toUpperCase()}${C.reset} ${C.bold}${finding.title}${C.reset}\n`,
    );
    out.write(`  ${C.cyan}${finding.file}${finding.line ? `:${finding.line}` : ""}${C.reset}\n`);
    if (finding.detail) {
      for (const line of wrap(finding.detail, 76)) out.write(`  ${C.grey}${line}${C.reset}\n`);
    }
    out.write("\n");
  }
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
