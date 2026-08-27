# pi-permissions

Claude-Code-parity permission engine for pi: full rule grammar (`Bash(glob)`,
`Read/Edit/Write(path)`, `WebFetch(domain:…)`, `mcp__server__tool`,
`Agent(name)`), four permission modes, dual-source config (Claude + pi
scopes), and pi-subagents child enforcement. Build plan:
[`../docs/pi-permissions-backlog.md`](../docs/pi-permissions-backlog.md)
(monorepo root).

**Status: FS0 — repo foundation & seed fork.** What works right now is the
ported upstream machinery: Shift+Tab mode cycling, `/permissions`, flags
(`--permission-mode`, `--dangerously-skip-permissions`), and the always-on
safety floor (catastrophic patterns, critical `rm -rf`, protected paths).
Everything else is a typed stub awaiting its feature set:

| Module | Filled by |
|---|---|
| `canonicalize.ts`, `loader.ts`, `rules/*` | FS1 — rule engine core |
| `modes.ts` rework (4-mode set, plan mode deleted) | FS2 — modes engine |
| `safety.ts`, `ask.ts`, `persist.ts` | FS3 — ask UX, persistence, safety port |

`reference/` holds the predecessor bridge engine (non-compiled; see
`reference/README.md`).

Attribution: seed fork of `@zackify/pi-claude-permissions` v1.0.6 (MIT) — see
NOTICE and LICENSE.

## Dev

```sh
npm install
npm test          # node:test with native TS type-stripping (node >= 22.6)
npm run typecheck # tsc --noEmit
```

Developed against node v26.6.0.
