# item1 — `/permissions on|off` runtime toggle

**Status:** in-flight (paused: pi 0.85.0 toolchain fix) · **Effort:** M · **Origin:** backlog workspace 2026-09-05 (was plan-permissions-toggle.md)

## Problem

User-facing: disable/re-enable the whole permission extension mid-session without restarting. No mechanism exists today — and there are legitimate moments (trusted bulk work) where floor+rules friction is unwanted but a full bypass-mode switch is not the right shape.

## Design / plan

- `index.ts` module state: `let pluginEnabled = true;` — reset to `true` in the `session_start` handler. Session-only, never persisted; a fresh session always starts protected.
- `registerCommand("permissions")` handler parses args (raw string; tolerate string[]):
  - `off` / `disable` → `pluginEnabled = false`
  - `on` / `enable` → `pluginEnabled = true`
  - empty → existing mode picker (unchanged)
  - anything else → `ctx.ui.notify("/permissions [on|off]", "warning")`
  - Arg parsing works in non-interactive ctx (`hasUI: false`); only the picker needs UI.
- Enforcement: in the `tool_call` handler, immediately after the hot-reload block and BEFORE the `isChild` branch: `if (!pluginEnabled) return;` — while off, every tool call is allowed with **no floor, no rules, no asks** (the floor bypass is the documented point of the switch).
- Status: while off the permissions slot shows `⊘ Permissions Off` (rule-count slot untouched); normal mode display restores on `on`.

## Acceptance criteria

- [ ] Default on: floor still blocks `~/.ssh` contact.
- [ ] After `off`: same command allowed; deny rules bypassed; status `⊘ Permissions Off`.
- [ ] After `on`: floor blocks again; mode display restored.
- [ ] Session restart resets to enabled.
- [ ] Gates: `npm run typecheck`, `npm run test` (new `tests/permissions-toggle.test.ts` + `parsePermissionsToggle` unit cases incl. invalid).

## Evidence / log

- 2026-09-05 plan authored; icon half landed; toggle not started — paused on pi 0.85.0 toolchain fix.
