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

---

# FS1 build notes (rule engine core)

Date: 2026-08-28 (system clock; the research/backlog docs carry a misdated
2026-08-31 header) · Charge: `~/.pi/tmp/fs1-charge.md`

## What was built

- `types.ts` (new) — shared shapes: `ParsedRule`, `RuleIssue`, `CompiledPath`,
  `CanonicalTarget`, `EvalResult`, `LoadedConfig`, `PiConfigKeys`, `McpRegistry`.
- `rules/parse.ts` (new) — Claude rule-string parser. Every known form of the
  grammar; invalid/unsupported specs return counted issues (bridge
  silent-skip defect fixed). Write(path) rejected (never consulted, Claude
  parity); `WebSearch(x)`, param forms, `mcp__…(…)`, `Agent(*)`, partial
  tool-name globs, unknown-tool specifiers → issues. Grep/Glob/Find/Ls fold
  into Read. `*`/`mcp__*` tool-globs: deny/ask only.
- `rules/bash.ts` — glob→regex with Claude word-boundary prefix semantics:
  trailing ` *` / `:*` compiles to `^P(?:\s.*)?$` (matches bare `P` too);
  glued `ls*` compiles `^ls.*$` (matches `lsof`); mid-`*` stays `.*`; exact
  otherwise. PowerShell case-insensitive (opt-in via tool name).
- `rules/paths.ts` — gitignore-style matcher, segment-DP with `**`. Anchors
  `//` (fs root), `~/` (home), `/` (source-scope anchor dir), `./`+slash-forms
  (cwd), bare = any depth. Trailing `/**` (or `/`) also matches the named
  root. Claude depth asymmetry: cwd-relative patterns with leading literal
  segment get any-depth matching for deny/ask only.
- `rules/webfetch.ts` — dot-bounded domains: apex-only `example.com`;
  `*.example.com` / leading-dot `.example.com` = subdomains ≥1 depth, no
  apex; `example.*` dot-bounded tail; `domain:*` = all; comma lists OR.
- `rules/mcp.ts` / `rules/agent.ts` — literal-prefix server/tool matching;
  exact agent names.
- `canonicalize.ts` — pi builtins map (bash→Bash, powershell→PowerShell,
  read/grep/find/ls→Read, edit→Edit, write→Write, web_fetch→WebFetch,
  web_search→WebSearch, subagent→Agent(input.agent)); MCP registry
  (mcp.json configs + adapter cache, both injectable; `buildDefaultMcpRegistry`
  reads real paths at runtime only, honoring PI_CODING_AGENT_DIR like the
  adapter's `getAgentDir`); gateway `mcp` dispatch in the adapter's own action
  order (tool → connect → describe → instructions → search → server →
  status), with server-scoped raw matching + short-form expansion +
  longest-prefix split + ambiguity guard mirroring
  `resolveServerFromToolName`. Unknown names fail safe to whole-tool `other`.
- `loader.ts` — dual-source loader (D3/D6/D7): 3 Claude + 3 pi scopes, union,
  dedupe with per-rule multi-source provenance, issues warn+count, pi config
  keys parsed (merged local > project > user), all paths injectable; plus the
  FS0 zackify config reader moved verbatim from index.ts
  (`loadZackifyCompatConfig` — replaces FS0's hardcoded `loadConfig()` as the
  single config surface; behavior identical until FS2 rewires onto
  `loadRules()` and deletes it).
- `evaluator.ts` — canonicalize→safety(hook, default pass-through)→deny→ask→
  allow, first-match per action; returns `{action, matchedRule, source}`.
  NOT yet wired into index.ts's tool_call handler — FS1 is pure logic (charge:
  no TUI behavior change); FS2/FS3 compose it with modes + the single ask UX.
- Tests: 76 (was 7). Grammar/matcher/merge tables incl. all six backlog
  table cases, evaluator property tests (seeded-LCG permutations: deny
  dominance, ask>allow, first-match stability, determinism), loader fixtures
  (hermetic — injectable paths prove no real-path reads), legacy-reader
  precedence pins, factory smoke (stub pi + redirected HOME). FS1 modules
  95–100% line coverage (uncovered: runtime-only `buildDefaultMcpRegistry`
  + defensive tails).

## Judgment calls (research doc left open — flagged for orchestrator)

1. **MCP canonical name = `mcp__server__<raw tool name>`** (registry truth),
   NOT the research doc §7 shorthand (`mempalace_search` → `…__search`).
   Rationale: the same underlying tool must canonicalize identically on both
   surfaces (direct wire name AND gateway `{tool}`), else ask-cache keys and
   rules split. The registry inverts `formatToolName` exactly; the shorthand
   split survives only as fallback for unregistered names. The backlog's
   "gateway `{tool:"search"}`" case is satisfied three ways: unique raw name
   (`search`), explicit-server raw/short form (`{server:"mempalace",
   tool:"search"}` — expands to the server-prefixed raw when the raw name
   itself carries the prefix), and prefixed wire form. Real-world mempalace
   (raw = `mempalace_search`, wire = `mempalace_mempalace_search`) and
   research-model (raw = `search`, wire = `mempalace_search`) both verified.
2. **Read/Edit/Write cross-tool matrix** (artifact §3, Edit row):
   Read deny/ask also blocks Edit/Write on the path (incl. creation); Edit
   rules govern Edit AND Write; Edit allow also grants Read; bare Write rules
   valid, `Write(path)` specs rejected.
3. **WebFetch domains**: apex-only for plain domains, subdomain-wildcard for
   `*.`/leading-dot (the charge's `.example.com` form folded in), per the
   2026 artifact table (older "plain matches subdomains too" behavior
   deliberately not replicated).
4. **Gateway meta actions**: `connect`/`instructions`/`server`-list →
   `mcp__server`; `describe` resolves like a tool call; `search` without a
   server filter, server-less auth actions, and status → whole gateway tool
   (`mcp`, matched by bare `mcp` rules and deny-`*`).
5. **pi-user scope honors `PI_CODING_AGENT_DIR`** (adapter `getAgentDir`
   semantics). D6's literal `~/.pi/agent/permissions.json` is the default
   when unset; env override makes probes hermetic — the FS0 caveat fix.
6. **`/path` anchor semantics** follow the artifact: anchored at the source
   scope's anchor dir (claude-project/local → project root = dirname²(file);
   claude-global/pi-user → home; pi-project/local → cwd).

## Known limitations (documented, phase-2+)

- No bash wrapper stripping / compound piecewise approval (parking lot) —
  full command text matched.
- No symlink dual-matching for path rules.
- Adapter prefix mode `"short"` approximated by the server-mode wire name
  (unused on this machine); `"none"` relies on unique-raw registration.
- A pi extension tool colliding by name with an MCP raw tool beyond the
  KNOWN_PI_TOOLS list could mis-canonicalize as MCP (the adapter's own
  BUILTIN_NAMES guard makes this near-impossible in practice).
- `mcpScript` canonicalizes whole-tool (`other`); its inner multi-calls are
  not decomposed (FS4+ if ever needed).

## FS2 handoff

- Build modes on `loadRules()` (loader.ts): `keys.defaultMode` is wired and
  merged (local > project > user); `keys.protectedPaths` /
  `productionSupport` / `children` / `persistTarget` are parsed, typed and
  waiting. Delete `loadZackifyCompatConfig` + its index.ts call site and
  rewire the factory onto the dual-source loader.
- The evaluator is the decision oracle: FS2 composes its verdict with mode
  baselines (`deny > ask > mode baseline > allow`); FS3 replaces the safety
  hook default with the real floor and owns ask UX + persistence.
- `CanonicalTarget.spec` is display-ready for the ask dialog;
  `piTool` carries the wire name for labeling.
- Registry: build once at session start via `buildDefaultMcpRegistry(ctx.cwd)`
  and pass to `canonicalize` per call; rebuild on FS5 hot-reload.

## Deviations

- None functional. Additions beyond the charged stub list: `types.ts`,
  `rules/parse.ts` (parser home), `evaluator.ts` (charged), tests/fixtures/.
- `tests/stubs.test.ts` split: FS1 modules assert implemented-exports;
  FS3 stubs (safety/ask/persist) keep throw-markers.
