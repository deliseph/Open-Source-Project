import type { Source } from "./source.js";
import type { Entry, ParseResult, PlatformId, Profile, Warning } from "./types.js";

/**
 * Handed to an adapter during a run. Anything an adapter can't make sense of
 * should be reported here rather than thrown — a single malformed file should
 * never cost the user the rest of their archive.
 */
export interface ParseContext {
  warn(message: string, path?: string): void;
  /** Everything reported so far this run. */
  readonly warnings: readonly Warning[];
}

/**
 * Teaches Archivore to read one platform's export.
 *
 * Writing one is the main way to contribute. The contract is two methods:
 * say whether an export looks like yours, and turn it into entries. See
 * `docs/writing-an-adapter.md` for a walkthrough.
 */
export interface Adapter {
  /** Short, lowercase, stable — it ends up in entry ids and folder names. */
  id: PlatformId;
  /** Shown to the user, e.g. "Instagram". */
  name: string;
  /** How a user gets this export, shown when we can't find one. */
  requestUrl?: string;

  /**
   * Confidence from 0 to 1 that this source is an export from this platform.
   *
   * Look for marker files rather than guessing from the folder name — people
   * rename downloads. Return 0 when nothing matches; the registry picks the
   * highest scorer.
   */
  detect(source: Source): Promise<number>;

  /** Reads the export. Should not throw for recoverable problems. */
  parse(source: Source, ctx: ParseContext): Promise<ParseResult>;
}

/** Collects warnings for one adapter run. */
export class WarningCollector implements ParseContext {
  readonly warnings: Warning[] = [];

  constructor(private readonly platform: PlatformId) {}

  warn(message: string, path?: string): void {
    this.warnings.push({ platform: this.platform, message, ...(path ? { path } : {}) });
  }
}

/**
 * Convenience for adapters: builds a ParseResult and sorts entries newest
 * first, which is the order every exporter wants them in.
 */
export function result(profile: Profile, entries: Entry[], ctx: ParseContext): ParseResult {
  entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { profile, entries, warnings: [...ctx.warnings] };
}

/**
 * Runs a parser over one file, turning a crash into a warning.
 *
 * Export files are frequently truncated or subtly malformed; this keeps one
 * bad file from aborting a multi-gigabyte import.
 */
export async function safely<T>(
  ctx: ParseContext,
  path: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    ctx.warn(`Could not read (${(error as Error).message})`, path);
    return undefined;
  }
}
