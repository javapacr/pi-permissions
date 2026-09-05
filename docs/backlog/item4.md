# item4 — Subagent inert gate (`PI_SUBAGENT_CHILD=1`)

**Status:** ready · **Effort:** M · **Origin:** backlog workspace 2026-09-05 (was plan-subagent-gate.md)

## Problem

pi-subagents child sessions should not run the permission plugin at all — the parent already gated the spawn. Today children still run a fail-closed **child baseline** (FS4): mode snapshot inherited, every would-prompt decision blocks with a surface-to-parent reason. That overhead (config reads, watchers, status, ask-degradation logic) is wasted work in a child.

## Design / plan

- `index.ts:91`: `const isChild = process.env.PI_SUBAGENT_CHILD === "1";` (the real pi-subagents child marker; `PI_SUBAGENTS` is NOT it).
- Promote `isChild` from "different baseline" to "fully inert":
  - `tool_call` handler: `if (isChild) return;` at the top (after the defensive `rulesLoaded` check) — no floor, no rules, no asks, no child baseline.
  - Skip status writes, session_start mode resolution, PS injection (already gated), shortcut/command registration (already gated), audit-log writes (once item3 lands).
  - `rulesLoaded`/watcher stay lazy/idle — no config reads, no watchers in children.
- The `child.ts` mode-snapshot machinery (extensionBindings → `PI_SUBAGENT_EXTENSION_BINDINGS`) is retired from the enforcement path; keep `allowAgentSpawn`'s injection only as long as the parent path needs it for backward compatibility of child sessions running the OLD extension build (verify: children with the new build never read it).
- README documents the semantics change: "subagent children run without permission enforcement by design; the parent is the gate."

## Acceptance criteria

- [ ] Child session (`PI_SUBAGENT_CHILD=1`): every tool call passes with zero extension work (no status slot, no watchers, no config reads).
- [ ] Parent unaffected: all four modes + floor behave exactly as before.
- [ ] README updated with the inert-children contract.
- [ ] Harness child-mode tests flipped from baseline-assertions to inert-assertions; suite green.

## Evidence / log

- (empty)
