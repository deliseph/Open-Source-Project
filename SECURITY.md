# Security policy

Archivore processes the most sensitive file most people will ever download: a complete
export of their private messages, photos and browsing history. Security reports are
taken seriously.

## Reporting a vulnerability

**Do not open a public issue.**

Use [GitHub's private vulnerability reporting](https://github.com/deliseph/archivore/security/advisories/new),
or email **imseph@gmail.com**.

Please include what you can: affected version, reproduction steps, and impact. A
redacted description of a file layout is fine — **never attach a real export.**

You can expect an acknowledgement within 72 hours and an assessment within 7 days.
If a fix is warranted we'll agree a disclosure timeline with you, and credit you in
the advisory unless you'd rather we didn't.

## Supported versions

Pre-1.0, fixes land on the latest released minor. Please upgrade before reporting.

## Threat model

What Archivore is designed to guarantee:

- **No data leaves your machine.** There is no HTTP client in the dependency tree.
  A network request from Archivore is a vulnerability — report it.
- **The generated `index.html` makes no external requests.** It embeds its data and
  loads nothing remotely. CI asserts this on every commit.
- **Untrusted content is escaped.** Everything in an export is attacker-controlled:
  anyone who sent you a DM chose that text. Captions and messages are HTML-escaped,
  and `</script>` sequences in the embedded JSON are neutralised, so a crafted message
  cannot execute script in your archive page. This is a tested case.
- **Your export is never modified.** Archivore opens sources read-only.

Out of scope:

- Anything the platform itself does with your data before you download it.
- Malicious files inside an export that exploit the *viewer* you open them with —
  Archivore copies media without parsing it.
- Someone with access to your unlocked machine reading the archive you built. The
  output is deliberately plain files; encrypt the folder if you need that.
