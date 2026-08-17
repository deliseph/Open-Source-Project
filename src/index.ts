/**
 * Archivore's programmatic API.
 *
 * The CLI is the front door, but everything it does is available here so you
 * can build the archive into your own tool — or write an adapter in your own
 * package and register it alongside the built-in ones.
 */

export type {
  ArchiveStats,
  Entry,
  EntryKind,
  MediaItem,
  MediaKind,
  Metrics,
  ParseResult,
  PlatformId,
  Profile,
  ThreadInfo,
  Warning,
} from "./core/types.js";

export type { Adapter, ParseContext } from "./core/adapter.js";
export { WarningCollector, result, safely } from "./core/adapter.js";

export type { Source } from "./core/source.js";
export { DirectorySource, ZipSource, openSource } from "./core/source.js";

export type { Detection } from "./core/registry.js";
export { adapters, detect, findAdapter, parseWith } from "./core/registry.js";

export type { ArchiveBundle, BuildOptions } from "./core/archive.js";
export { build, writeJson } from "./core/archive.js";

export { writeHtml } from "./export/html.js";
export { writeMarkdown } from "./export/markdown.js";

export { decodeText, repairDeep, repairMojibake } from "./core/text.js";
export { formatBytes, guessMediaKind, parseTimestamp, slugify, stableId } from "./core/util.js";

export { instagram } from "./adapters/instagram.js";
export { mastodon } from "./adapters/mastodon.js";
export { snapchat } from "./adapters/snapchat.js";
export { tiktok } from "./adapters/tiktok.js";
export { x } from "./adapters/x.js";
