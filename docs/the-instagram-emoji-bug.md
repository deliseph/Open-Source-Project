# Instagram mangles every emoji in your data export

If you have ever downloaded your Instagram data, open one of the JSON files and search
for a caption you know had an emoji in it.

You will not find the emoji. You will find this:

```
"title": "cafÃ© ðŸ˜€"
```

That was `café 😀`. Every emoji, every accent, every non-Latin character in your
captions, your bio and your direct messages arrives like this. It is not your text
editor, and it is not a font problem. The bytes in the file are genuinely wrong.

It is also completely reversible, which is the interesting part.

## What actually happened

`café 😀` in UTF-8 is ten bytes:

```
63 61 66 c3 a9 20 f0 9f 98 80
 c  a  f  ---é---  ␣ -----😀-----
```

UTF-8 is a variable-width encoding. `c` is one byte. `é` is two. `😀` is four. That is
the whole point of it — every character above ASCII is a *sequence* of bytes that means
one character.

Instagram's exporter loses that grouping. Somewhere in the pipeline the file's bytes are
decoded as **Latin-1** instead of UTF-8. Latin-1 is a single-byte encoding: every byte
is exactly one character, always. So the decoder walks the ten bytes above and produces
ten characters instead of six:

```
c   a   f   Ã   ©   ␣   ð   Ÿ   ˜   €
63  61  66  c3  a9  20  f0  9f  98  80
```

Then that ten-character string gets encoded back to UTF-8 and written to the JSON file.
The damage is now baked into the bytes on disk. `é` has become `Ã©`. `😀` has become
`ðŸ˜€`, four separate characters, one per byte of the original.

A note on that last one, since it trips people up when they go looking. Latin-1 maps
`9f`, `98` and `80` to C1 *control* characters, which are invisible. Most editors and
browsers actually decode using Windows-1252, which puts printable glyphs at those
positions — so what you see on screen is `ðŸ˜€`. Same bytes, different rendering.

This class of bug has a name — *mojibake* — and it is one of the oldest mistakes in
text handling. Seeing it in a production export pipeline at this scale is the surprising
part, not the mechanism.

There is a small extra insult. The mangled version is *larger*: escaped into JSON,
`café 😀` is 9 characters and the corrupted version is 12. The export is paying extra
bytes to be wrong.

## Undoing it

Since the transformation is a pure round trip through Latin-1, reversing it is one line:

```js
Buffer.from(mangled, "latin1").toString("utf8");
```

Map each character back to the single byte it came from, then decode those bytes as
UTF-8 like they should have been in the first place.

```js
Buffer.from("cafÃ© ðŸ˜€", "latin1").toString("utf8");
// → "café 😀"
```

That is the whole fix. If it were only that, this would be a tweet.

## Why you cannot just always do it

The catch is that this transformation is destructive when applied to text that was never
broken. Consider:

```js
Buffer.from("50° today", "latin1").toString("utf8");
// → "50� today"
```

`°` is a legitimate single character. Reinterpreting it as a byte produces `0xB0`, which
is a UTF-8 *continuation* byte with no lead byte in front of it — invalid. The decoder
substitutes U+FFFD, the replacement character, and the degree sign is gone for good.

So a repair function that runs blindly over an export will fix your emoji and destroy
every naturally-occurring accented character that Instagram happened to get right.

The distinguishing test is that **mojibake is always valid UTF-8 when reinterpreted as
bytes, and accidentally-Latin-1 text usually is not.** So you attempt the reinterpretation
and only keep it if the result decodes cleanly:

```js
export function repairMojibake(input) {
  let suspect = false;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // A real emoji or CJK character proves the string decoded correctly —
    // mojibake never contains anything above U+00FF.
    if (code > 0xff) return input;
    if (code >= 0x80) suspect = true;
  }
  if (!suspect) return input;

  const repaired = Buffer.from(input, "latin1").toString("utf8");

  // U+FFFD means the bytes weren't valid UTF-8, so this was genuine Latin-1
  // text rather than mojibake. Keep the original.
  if (repaired.includes("�") && !input.includes("�")) return input;

  return repaired;
}
```

Three properties fall out of this, and all three matter:

- **Healthy text is untouched.** Pure ASCII exits at the `suspect` check.
- **Already-correct Unicode is untouched.** A string containing a real `😀` has a
  character above U+00FF, which is proof it was decoded properly. Bail immediately.
- **It is idempotent.** Running it twice gives the same answer as running it once,
  because after the first pass the string contains real emoji and hits the check above.

That last one is what makes it safe to apply broadly to an export where some files are
damaged and some are not, without tracking which is which.

## Why this survives

Nobody looks. An export is a 4GB ZIP that took up to four days to arrive, containing
folders of `posts_1.json` next to a `media/` directory where the filenames are hashes.
Almost everyone opens it once, fails to find what they wanted, and never opens it again.
The people who *do* read the JSON are usually looking for a specific post, not auditing
the encoding of their own captions.

And the failure is silent. There is no error. The file is valid JSON and valid UTF-8. It
just says something different from what you wrote.

This is what data portability looks like in practice. GDPR Article 20 says you have the
right to receive your personal data "in a structured, commonly used and machine-readable
format." A ZIP of JSON is all three of those things, and it is still unusable, because
nothing in the law says the text has to be correct.

## The tool

I got annoyed enough to write [**Archivore**](https://github.com/deliseph/archivore) — it
reads the export ZIPs from Instagram, TikTok, Snapchat, X and Mastodon and turns them
into one searchable archive that opens in your browser. The repair above is applied
throughout, and exported on its own if you only want that part.

```bash
npx archivore build instagram.zip tiktok.zip -o ~/my-archive
```

It makes no network requests — there is no HTTP client in the dependency tree, and CI
fails the build if anyone adds one. It has one runtime dependency, for reading ZIPs.

Adapters for other platforms are about 100 lines. Facebook, Reddit, LinkedIn, Discord
and Bluesky are all open issues if you want one.
