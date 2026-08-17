/**
 * The canonical shape every platform gets normalised into.
 *
 * This is deliberately small. An adapter's job is to lose as little as
 * possible while mapping into these types — anything that doesn't fit goes
 * into `raw`, which is preserved verbatim so no information is destroyed.
 */

/** Platform identifier. Adapters are free to add new ones. */
export type PlatformId = string;

export type EntryKind =
  | "post"
  | "story"
  | "memory"
  | "message"
  | "comment"
  | "like"
  | "follow"
  | "search"
  | "other";

export type MediaKind = "image" | "video" | "audio" | "unknown";

export interface MediaItem {
  /** Path relative to the root of the source export. */
  sourcePath: string;
  kind: MediaKind;
  /** Caption attached to this specific item, if the platform stores one. */
  caption?: string;
  takenAt?: Date;
  width?: number;
  height?: number;
  /** Set by the writer once the file has been copied into the archive. */
  archivePath?: string;
}

export interface Metrics {
  likes?: number;
  replies?: number;
  reposts?: number;
  views?: number;
}

export interface ThreadInfo {
  conversationId?: string;
  /** Display name or handle of the sender, for messages. */
  from?: string;
  participants?: string[];
}

/**
 * One thing that happened on a platform: a post, a DM, a saved memory.
 */
export interface Entry {
  /** Stable within a platform. Used to de-duplicate across re-imports. */
  id: string;
  platform: PlatformId;
  kind: EntryKind;
  createdAt: Date;
  text?: string;
  media: MediaItem[];
  metrics?: Metrics;
  thread?: ThreadInfo;
  /** Permalink back to the original, when the export provides one. */
  url?: string;
  /**
   * The original record, untouched. Kept so that a future version of
   * Archivore can extract more without asking you to re-download a 4GB ZIP.
   */
  raw?: unknown;
}

export interface Profile {
  platform: PlatformId;
  handle?: string;
  displayName?: string;
  /** When the platform generated the export, if it says. */
  exportedAt?: Date;
}

/** Non-fatal problems worth showing the user at the end of a run. */
export interface Warning {
  platform: PlatformId;
  message: string;
  /** File the problem came from, when known. */
  path?: string;
}

export interface ParseResult {
  profile: Profile;
  entries: Entry[];
  warnings: Warning[];
}

/** Summary of a completed archive build. */
export interface ArchiveStats {
  entries: number;
  media: number;
  mediaBytes: number;
  byPlatform: Record<PlatformId, number>;
  byKind: Record<string, number>;
  earliest?: Date;
  latest?: Date;
  warnings: Warning[];
}
