# Splitting this into its own repository

Crosscheck was developed inside the Archivore repository because that session only had
write access to it. It is a standalone project with its own `package.json`, tests and
README, and it belongs in its own repo.

Delete this file once you've done the split.

## Option 1 — keep the commit history (preferred)

`git subtree` rewrites the commits that touched `crosscheck/` into a standalone branch:

```bash
# from the root of this repository
git subtree split --prefix=crosscheck -b crosscheck-only

mkdir ../crosscheck && cd ../crosscheck
git init
git pull ../Open-Source-Project crosscheck-only
```

Then create an empty `crosscheck` repo on GitHub and push:

```bash
git remote add origin git@github.com:deliseph/crosscheck.git
git push -u origin main
```

## Option 2 — start clean

If the history doesn't matter:

```bash
cp -r crosscheck ../crosscheck
cd ../crosscheck
rm -rf node_modules dist SPLIT-OUT.md
git init && git add -A && git commit -m "Initial commit"
```

## Afterwards

In the Archivore repo:

```bash
git rm -r crosscheck
git commit -m "Move Crosscheck to its own repository"
```

Then in the new repo: set the description and topics (`ai-agents`, `multi-agent`,
`code-review`, `claude-code`, `codex`, `developer-tools`), and `npm publish` — the
name `crosscheck` was unclaimed on npm as of this writing, so check it's still free
before announcing anything.
