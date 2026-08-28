# pi-permissions

Claude-Code-parity permission engine for pi: full rule grammar (`Bash(glob)`,
`Read/Edit/Write(path)`, `WebFetch(domain:…)`, `mcp__server__tool`,
`Agent(name)`), four permission modes, dual-source config (Claude + pi
scopes, hot-reloaded live), a doctor-style `/permissions` diagnostics view,
and pi-subagents child enforcement (mode inheritance + `Agent(name)` gating).
Build plan: [`../docs/pi-permissions-backlog.md`](../docs/pi-permissions-backlog.md)
(monorepo root); per-FS detail in `NOTES.md`.

## Modes (Shift-order cycling via `ctrl+shift+m`)

| Mode | Icon | Behavior |
|---|---|---|
| `default` | ⏵ | Reads free; every other tool prompts unless allowed |
| `acceptEdits` | ⏵⏵ | Write/edit auto-allowed; rest per default |
| `production-support` | 🛡 | Investigation mode: reads + safelisted read-only bash free; everything else prompts; investigation framing injected |
| `bypassPermissions` | ⏵⏵⏵⏵ | Startup default: everything passes except deny/ask rules + safety floor |

Invariant: **deny > ask > mode baseline > allow** — deny rules and the
always-on safety floor (catastrophic patterns, critical `rm -rf`, protected
paths — read-gated) block in every mode; ask rules prompt in every mode.

### Keyboard shortcut — why not Shift+Tab

pi 0.84.3 binds `shift+tab` natively (`app.thinking.cycle`, cycle thinking
level) and puts it on the extension-conflict RESERVED list — an extension
registering it is dropped with a startup warning (no override mechanism
exists on `registerShortcut`). The cycle key is therefore **`ctrl+shift+m`**
(mnemonic: mode; verified free across pi's entire builtin keymap). The
`/permissions` picker title carries the same hint.

## Status bar

Two footer slots: `permissions` (mode icon + label) and `permissions-rules`
(`π <allow>a·<deny>d·<ask>q`, plus ` ⚠<n>` when invalid specs were counted) —
rule counts refresh on every rule/config change.

## Hot-reload (live config)

The parent session watches the parent directories of all nine inputs — six
rule/config scopes (`<cwd>/.claude/settings{,.local}.json`,
`~/.config/claude/settings.json`, `<agentDir>/permissions.json`,
`<cwd>/.pi/permissions{,.local}.json`) plus the MCP registry files
(`<agentDir>/mcp.json`, `<agentDir>/mcp-cache.json`, `<cwd>/.pi/mcp.json`).
Any change applies from the **next tool call** — no restart, no prompt. Rule
edits clear the session ask-cache (a removed rule must not keep honoring old
approvals). Directories that don't exist yet are covered by their nearest
existing ancestor (watching for their creation); a file created later — e.g.
`.pi/permissions.local.json` written by "Always" — is picked up the moment
its directory is watched. Children (pi-subagents) run without watchers:
per-spawn processes read fresh state at startup and keep their mode snapshot.

## `/permissions` diagnostics

`/permissions` keeps the mode picker primary (4 modes first) with a trailing
`🩺 Diagnostics` entry: mode + how it was set (flag / defaultMode config /
cycling / picker), the full rule table grouped by source file with
multi-source provenance, invalid-spec warnings with file + message, the child
policy (agentModes overrides + inheritance channel state), and hot-reload
status (watched dirs, pending change, last load). Sections are paged
`ui.select` dialogs — esc navigates back/out.

## Dev

```sh
npm install
npm test          # node:test with native TS type-stripping (node >= 22.6)
npm run typecheck # tsc --noEmit
```

Developed against node v26.6.0. Deps dev-only; runtime imports are
`import type` from `@earendil-works/pi-coding-agent` plus `node:*` builtins.

Attribution: seed fork of `@zackify/pi-claude-permissions` v1.0.6 (MIT) — see
NOTICE and LICENSE.
