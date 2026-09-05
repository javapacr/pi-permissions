# item12 — Script invocation caps (exfil-loop defense-in-depth)

**Status:** ready · **Effort:** S · **Origin:** 2026-09-05 Claude Code env-protection parity analysis (companion work lives in pi-claude-sandbox `docs/backlog/` items 1–3)

Claude reference: `CLAUDE_CODE_SCRIPT_CAPS` — https://code.claude.com/docs/en/env-vars — "JSON object limiting how many times specific scripts may be invoked per session… Keys are substrings matched against the command text; values are integer call limits… Runtime fan-out via `xargs` or `find -exec` is not detected; this is a defense-in-depth control".

## Problem

Permission rules decide *whether* a command may run; nothing limits *how often*. A prompt-injection loop that hammers an allowed egress-shaped command (curl/wget to a safelisted read verb, a repeated script) has no ceiling. Claude ships a per-session invocation cap as cheap defense-in-depth; we retired pi-tool-call-counter but never repurposed counting toward safety.

## Design / plan

- Config key (permissions config): `scriptCaps: Record<string, number>` — substring → max invocations **per session**.
- Count in the existing tool_call path, evaluated on the **stamped original command** (same contract as the floor judge), so RTK/sandbox mutations don't dodge counting. Counting happens regardless of allow/ask/deny outcome — the cap is about repetition, not authorization.
- On exceed: block with a falsifiable reason (matched substring, count, limit) + the config key to adjust. Session-scoped counter (reset on new session; no persistence).
- Accepted blind spot, documented not fixed: `xargs`/`find -exec` runtime fan-out (Claude has the identical gap) — belongs to the phase-2 compound-decomposition bundle (item11's FS1 residual).

## Acceptance criteria

- [ ] `scriptCaps: {"curl": 3}` → 4th curl-bearing command blocked, reason cites count + key.
- [ ] Counting unaffected by sandbox wrap/RTK mutations (stamped original used).
- [ ] Cap hit on an otherwise-allowed command still blocks (independent of mode; floor precedence respected).
- [ ] No config → zero behavior change. Tests + repo `tsc --noEmit` green.

## Evidence / log

- (empty)
