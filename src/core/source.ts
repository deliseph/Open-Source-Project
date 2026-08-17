import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import yauzl from "yauzl";

import { decodeText } from "./text.js";

/**
 * A read-only view over an export, whether it arrived as a directory or a ZIP.
 *
 * Adapters only ever see this interface, so an adapter written against an
 * unzipped folder works unchanged on a 4GB ZIP nobody wants to extract.
 * All paths are POSIX-style and relative to the root of the export.
 */
export interface Source {
  /** Every file path in the export, sorted. */
  list(): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Buffer>;
  /** Reads a file as text, repairing the mojibake platforms ship. */
  readText(path: string): Promise<string>;
  readJSON<T = unknown>(path: string): Promise<T>;
  /** Paths matching a pattern, in listing order. */
  find(pattern: RegExp): Promise<string[]>;
  /** Streams a file out to disk without buffering it in memory. */
  copyTo(path: string, destination: string): Promise<number>;
  close(): Promise<void>;
}

function toPosix(p: string): string {
  return p.split(sep).join(posix.sep);
}

/** An export that has already been unzipped into a folder. */
export class DirectorySource implements Source {
  #root: string;
  #cache: string[] | undefined;

  constructor(root: string) {
    this.#root = root;
  }

  async list(): Promise<string[]> {
    if (this.#cache) return this.#cache;
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const items = await readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const full = join(dir, item.name);
        if (item.isDirectory()) await walk(full);
        else if (item.isFile()) out.push(toPosix(relative(this.#root, full)));
      }
    };
    await walk(this.#root);
    out.sort();
    this.#cache = out;
    return out;
  }

  async exists(path: string): Promise<boolean> {
    try {
      const info = await stat(join(this.#root, path));
      return info.isFile();
    } catch {
      return false;
    }
  }

  async read(path: string): Promise<Buffer> {
    return readFile(join(this.#root, path));
  }

  async readText(path: string): Promise<string> {
    return decodeText(await this.read(path));
  }

  async readJSON<T = unknown>(path: string): Promise<T> {
    return JSON.parse(await this.readText(path)) as T;
  }

  async find(pattern: RegExp): Promise<string[]> {
    return (await this.list()).filter((p) => pattern.test(p));
  }

  async copyTo(path: string, destination: string): Promise<number> {
    await mkdir(dirname(destination), { recursive: true });
    const source = join(this.#root, path);
    await pipeline(createReadStream(source), createWriteStream(destination));
    return (await stat(destination)).size;
  }

  async close(): Promise<void> {
    // Nothing to release.
  }
}

/** An export still inside its ZIP. Entries are read on demand. */
export class ZipSource implements Source {
  #zip: yauzl.ZipFile;
  #index: Map<string, yauzl.Entry>;
  #paths: string[];

  private constructor(zip: yauzl.ZipFile, index: Map<string, yauzl.Entry>) {
    this.#zip = zip;
    this.#index = index;
    this.#paths = [...index.keys()].sort();
  }

  /**
   * Reads the ZIP's central directory up front — cheap, it's just the index —
   * then keeps the handle open for random access to individual files.
   */
  static async open(file: string): Promise<ZipSource> {
    const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
      yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, z) => {
        if (err || !z) reject(err ?? new Error(`Could not open ${file}`));
        else resolve(z);
      });
    });

    const index = new Map<string, yauzl.Entry>();
    await new Promise<void>((resolve, reject) => {
      zip.on("entry", (entry: yauzl.Entry) => {
        // Directory records end in "/" and carry no content.
        if (!entry.fileName.endsWith("/")) index.set(entry.fileName, entry);
        zip.readEntry();
      });
      zip.on("end", resolve);
      zip.on("error", reject);
      zip.readEntry();
    });

    return new ZipSource(zip, index);
  }

  async list(): Promise<string[]> {
    return this.#paths;
  }

  async exists(path: string): Promise<boolean> {
    return this.#index.has(path);
  }

  #stream(path: string): Promise<Readable> {
    const entry = this.#index.get(path);
    if (!entry) throw new Error(`Not found in archive: ${path}`);
    return new Promise((resolve, reject) => {
      this.#zip.openReadStream(entry, (err, s) => {
        if (err || !s) reject(err ?? new Error(`Could not read ${path}`));
        else resolve(s);
      });
    });
  }

  async read(path: string): Promise<Buffer> {
    const stream = await this.#stream(path);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async readText(path: string): Promise<string> {
    return decodeText(await this.read(path));
  }

  async readJSON<T = unknown>(path: string): Promise<T> {
    return JSON.parse(await this.readText(path)) as T;
  }

  async find(pattern: RegExp): Promise<string[]> {
    return this.#paths.filter((p) => pattern.test(p));
  }

  async copyTo(path: string, destination: string): Promise<number> {
    await mkdir(dirname(destination), { recursive: true });
    const stream = await this.#stream(path);
    await pipeline(stream, createWriteStream(destination));
    return (await stat(destination)).size;
  }

  async close(): Promise<void> {
    this.#zip.close();
  }
}

/** Opens a path as a Source, picking the implementation by what's there. */
export async function openSource(path: string): Promise<Source> {
  const info = await stat(path);
  if (info.isDirectory()) return new DirectorySource(path);
  if (path.toLowerCase().endsWith(".zip")) return ZipSource.open(path);
  throw new Error(`Expected a directory or a .zip file, got: ${path}`);
}
