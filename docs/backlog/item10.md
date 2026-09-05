# item10 — Upstream pi-core filing: `before_agent_start` bypass on intercom turns

**Status:** optional · **Effort:** S · **Origin:** plan-ps-injection-intercom.md step 4; root-caused 2026-09-05 (NOTES.md "Intercom PS entry framing")

## Problem

pi-core (0.84.4) consumes `before_agent_start` custom messages ONLY in `AgentSession.prompt()` (`dist/core/agent-session.js:914-930`). pi-intercom's idle delivery enters via `sendCustomMessage(…, {triggerTurn:true})` → `_runAgentPrompt` (`:1121`), which never emits the event — extensions returning custom messages on `before_agent_start` silently lose them on intercom-initiated turns. TUI/print/RPC all converge on `prompt()`; only the intercom path bypasses.

## Design / plan

- File an issue on the pi repo with: the two file:line anchors, a minimal repro (extension returning `{message}` on `before_agent_start`; drive one turn via TUI → lands, one via intercom → absent), and the JSONL evidence shape (`intercom_message` present, extension `customType` absent).
- Note the shipped extension workaround (pi-permissions d1aa10b: `turn_start(0)` steer delivery) — the filing is a contract fix, not a blocker; the workaround does not depend on it.
- Optional: propose the core fix (route `triggerTurn` through the same preflight consume-and-prepend as `prompt()`), or offer the PR.
- Re-run note from the plan: the original repro was observed on pi 0.84.x; RCA was done on 0.84.4 — confirm against 0.85.0 dist before filing if the installed version has moved.

## Acceptance criteria

- [ ] Issue filed with repro + evidence links; workaround noted.
- [ ] (If accepted) PR or upstream tracking reference added here.

## Evidence / log

- 2026-09-05 root cause + workaround shipped (d1aa10b); live-probe evidence in NOTES.md and monorepo `docs/pi-permissions.md` verification log.
