/**
 * Text repair.
 *
 * Several platforms — Instagram most notoriously — build their export files by
 * taking UTF-8 bytes and writing each individual byte out as if it were a
 * Latin-1 character. A "😀" (bytes F0 9F 98 80) arrives in the JSON as the
 * four escapes ð, and a naive reader renders it as
 * "ð". Every emoji, accent and non-Latin script in your
 * captions is mangled this way.
 *
 * The damage is reversible: map each character back to the byte it was meant
 * to be, then decode the result as UTF-8. The risk is doing it to text that
 * was never broken, so `repairMojibake` only commits to the change when the
 * bytes form a clean UTF-8 sequence.
 */

const REPLACEMENT = "�";

/** Decodes a file's bytes to a string, dropping a leading BOM. */
export function decodeText(buffer: Buffer): string {
  const text = buffer.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Reverses Latin-1-encoded UTF-8 ("mojibake"), leaving healthy text alone.
 *
 * Returns the input unchanged when the string shows no sign of the bug or
 * when the reinterpretation would produce invalid UTF-8 — so it is safe to
 * run over text that may or may not be damaged.
 */
export function repairMojibake(input: string): string {
  if (!input) return input;

  let suspect = false;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // A real emoji or CJK character proves the string was decoded correctly;
    // mojibake never contains anything above U+00FF.
    if (code > 0xff) return input;
    if (code >= 0x80) suspect = true;
  }
  if (!suspect) return input;

  const repaired = Buffer.from(input, "latin1").toString("utf8");

  // If the bytes weren't valid UTF-8 the decoder inserts U+FFFD. That means
  // the string was genuinely Latin-1 text, not mojibake — keep the original.
  if (repaired.includes(REPLACEMENT) && !input.includes(REPLACEMENT)) {
    return input;
  }
  return repaired;
}

/**
 * Applies {@link repairMojibake} to every string in a parsed JSON value.
 *
 * Object keys are repaired too, since platforms mangle conversation titles
 * and participant names that get used as keys.
 */
export function repairDeep<T>(value: T): T {
  if (typeof value === "string") return repairMojibake(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => repairDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[repairMojibake(key)] = repairDeep(val);
    }
    return out as T;
  }
  return value;
}
