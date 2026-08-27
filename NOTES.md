# FS0 build notes (for the orchestrator / FS1 builder)

Date: 2026-08-31 · Charge: `~/.pi/tmp/fs0-charge.md` · Backlog: `../docs/pi-permissions-backlog.md`

## What was built

- Faithful port of zackify v1.0.6 `extensions/index.ts`, split into:
  - `index.ts` — factory + flags + config load + plan-mode machinery +
    always-on safety + approval prompting + `tool_call` enforcement;
  - `modes.ts` — mode definitions, custom-mode normalization, Shift+Tab
    ordering, mode fallback helpers (exported; the only new `export` keywords).
  No logic changes; minimal-diff port for future upstream comparison.
- Bridge engine grafted verbatim into `reference/` (provenance header
  prepended to each file, `reference/README.md` explains status).
- Typed throwing stubs for every FS1–FS3 module (`canonicalize.ts`,
  `loader.ts`, `rules/*`, `safety.ts`, `ask.ts`, `persist.ts`).
- `tests/` guards: manifest string-array trap, entrypoint default export,
  mode set (incl. dormant plan), stub export+throw markers, reference
  provenance headers.
- Test runner: `node:test` + native TS type-stripping. No vitest — deps are
  only `typescript`, `@types/node`, `@earendil-works/pi-coding-agent`
  (type-only; satisfies the authoring skill's runtime-import constraints:
  extension code imports only `@earendil-works/pi-coding-agent` as
  `import type` plus `node:*` builtins).

## FS1 handoff notes / known FS0 limitations

- **Config paths still upstream-hardcoded**: `loadConfig()` reads
  `~/.pi/agent/extensions/permissions.json`, cwd `.pi/extensions/permissions.json`,
  `~/.pi/agent/settings.json`, cwd `.pi/settings.json` — verbatim zackify
  paths. It does **not** honor `PI_CODING_AGENT_DIR`. Consequence: a probe
  session under an isolated agent dir still reads the *real*
  `~/.pi/agent/settings.json` (`piClaudePermissions` block). Harmless for
  load acceptance (unknown keys ignored, defaults apply), but a fidelity
  caveat for behavioral probes. Fixing this is FS1 loader work (D6:
  3 Claude + 3 pi scopes).
- **Plan mode is dormant, not deleted**: all 4 zackify modes ported; FS2
  deletes plan and reworks the set per D1/D2. `tests/modes.test.ts` documents
  this so the FS2 deletion shows up as a deliberate test change.
- **Safety floor still lives in `index.ts`** (`enforceAlwaysOnSafety`,
  catastrophic/rm-rf/protected-path checks, `promptApproval`). FS3 extracts
  it to `safety.ts`/`ask.ts` and adds read gating.
- **`reference/` is excluded from tsc** (`tsconfig.json`) and never imported.
  Do not import it from live code; FS1 supersedes it and may delete it.
- **`import type` discipline**: node type-stripping requires type-only
  imports as a separate `import type { … }` statement — a mixed
  value/type import from `./modes.ts` would pass tsc but break `npm test`
  at runtime. Keep the two-statement form used in `index.ts`.
- **Node requirement**: `npm test` needs node ≥ 22.6 (native `.ts` execution;
  this machine runs v26.6.0). Relative imports must carry explicit `.ts`
  extensions (`allowImportingTsExtensions` + `noEmit` in tsconfig).
- **Entry manifest**: `"pi": { "extensions": ["./index.ts"] }` — string array
  (the silent-drop trap from the pi-mempalace incident);
  `tests/manifest.test.ts` is the standing guard.
- Git: local repo, branch `main` (matches siblings), two commits, **no
  remote configured** (orchestrator adds `javapacr/pi-permissions` at push
  time — rollout is FS6). `package-lock.json` is committed (majority sibling
  convention: pi-tool-prompt, pi-mempalace, pi-env-loader commit it).
- Monorepo root `.gitignore` does not yet list `/pi-permissions/` — the FS0
  builder may not edit outside this repo; the orchestrator owns that line.

## Deviations from the FS0 charge/spec

- None functional. Choices within granted latitude:
  - `node:test` over vitest (node 26 native TS support; leaner install).
  - Stub function names/signatures are provisional — FS1 reworks them; the
    stubs exist to prove the module graph and give FS1 honest anchor points.
- `npm test` runs `node --test tests/*.test.ts` (shell-expanded file list),
    not the spec's `node --test tests/` — node 26 rejects the bare-directory
    form as a module entry (MODULE_NOT_FOUND). Glob and cwd-discovery forms
    verified green.
- Probe-dir action (manager, outside this repo): copied `~/.pi/agent/auth.json`
    → `~/.pi/tmp/pi-permissions-probe/auth.json` (mode 0600 preserved) because the
    probe agent dir shipped with no auth — any model call exited at "No API key".
    It contains a live API key: **delete it when the probe profile retires
    (post-FS6)**. Note the builder-session sandbox still blocks the provider
    endpoint, so headless model round-trips remain impossible from the builder
    pane; the copy primarily enables the orchestrator's Herdr-tab probe.
