# item7 — `protectedPaths` config must extend, not replace

**Status:** ready (safety-relevant) · **Effort:** S · **Origin:** backlog workspace 2026-09-05 (was plan-protectedpaths-merge.md; finding 2026-09-04 attestation review)

## Problem

`index.ts` reloadState wires:

```ts
const protectedPaths = (loaded.keys.protectedPaths ?? DEFAULT_PROTECTED_PATHS).map(…)
```

A `protectedPaths` key in any pi-\* scope **replaces** the defaults wholesale (and `mergeKeys` makes the last defining scope win). A careless config silently drops `~/.ssh`/`~/.aws` from floor protection. Suspected live instance to verify: the monorepo project layer `.pi/extensions/permissions.json` sets `protectedPaths: ["~/.pi/envs"]` — confirm which loader scope reads it and whether monorepo sessions currently run a shrunken floor.

## Design / plan

- Merge instead: `const protectedPaths = [...DEFAULT_PROTECTED_PATHS, ...(loaded.keys.protectedPaths ?? [])]` — config can only ADD paths; defaults can never shrink. Dedupe after `~`-expansion (both lists flow through the existing expansion map; dedupe on the resolved absolute string).
- The same replace-semantics exists across scopes via `mergeKeys` (`loader.ts`): last-write-wins for the KEY, but with defaults always included the merge direction stops being safety-relevant. Leave `mergeKeys` as is.
- Intentional-escape hatch: if someone genuinely wants a minimal list, that becomes an explicit future key (e.g. `protectedPathsReplace: true`); do NOT build it now.

## Acceptance criteria

- [ ] Config adding `~/secrets` → floor protects defaults + `~/secrets`.
- [ ] Config with a bogus list (e.g. only `~/x`) → floor STILL protects all defaults.
- [ ] Monorepo `.pi/extensions/permissions.json` case verified (loader scope identified; floor not shrunken there).
- [ ] Test in the existing floor/hot-reload test style; suite green.

## Evidence / log

- (empty)
