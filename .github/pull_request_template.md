## What this changes

<!-- One or two sentences. If it fixes an issue, say "Fixes #123". -->

## Why

<!-- Especially useful for adapters: what does this platform's export look like, and
     what was surprising about it? -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] **No real export data is committed** — fixtures are hand-written with invented content
- [ ] No new runtime dependency (or discussed in an issue first)
- [ ] No new network call (or discussed in an issue first — see CONTRIBUTING.md)

### If this adds an adapter

- [ ] `detect` inspects file contents and returns `0` when unsure
- [ ] `parse` wraps file reads in `safely()` and never throws
- [ ] `raw` is set on every entry
- [ ] `ctx.warn()` covers anything the export omits or lets expire
- [ ] Registered in `src/core/registry.ts` and exported from `src/index.ts`
- [ ] Row added to the README table

<!-- Draft PRs are welcome. If you're stuck on a format, open one and ask. -->
