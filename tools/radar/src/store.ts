import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Remembers what you've already been shown.
 *
 * Without this every run re-surfaces the same threads and you stop reading the
 * digest, which defeats the point. Stored as plain JSON so you can open it,
 * and so deleting it is an obvious way to start over.
 */

interface State {
  seen: Record<string, string>;
  history: { at: string; stars?: number; outsideContributors?: number }[];
}

const EMPTY: State = { seen: {}, history: [] };

export class Store {
  #path: string;
  #state: State = EMPTY;

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<void> {
    try {
      this.#state = { ...EMPTY, ...JSON.parse(await readFile(this.#path, "utf8")) };
    } catch {
      // First run, or the file was deleted to reset. Either is fine.
      this.#state = { ...EMPTY, seen: {}, history: [] };
    }
  }

  isNew(id: string): boolean {
    return !(id in this.#state.seen);
  }

  markSeen(ids: string[]): void {
    const now = new Date().toISOString();
    for (const id of ids) this.#state.seen[id] = now;
  }

  /** Records a stats snapshot so `radar stats` can show movement, not just totals. */
  recordStats(stars: number, outsideContributors: number): void {
    this.#state.history.push({ at: new Date().toISOString(), stars, outsideContributors });
    // A year of daily runs is plenty; drop the oldest beyond that.
    if (this.#state.history.length > 365) this.#state.history.shift();
  }

  /** The previous snapshot, for showing change since last run. */
  previousStats(): { stars?: number; outsideContributors?: number } | undefined {
    return this.#state.history[this.#state.history.length - 2];
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, JSON.stringify(this.#state, null, 2), "utf8");
  }
}
