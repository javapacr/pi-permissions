# item3 — Ask audit log (JSONL, monthly shards)

**Status:** ready · **Effort:** M · **Origin:** backlog workspace 2026-09-05 (was plan-audit-log.md)

## Problem

Capture every ask decision so `permissions.json` can later be enhanced from evidence — mine frequent approvals into `allow` rules, spot noisy ask rules. Today decisions vanish with the session.

## Design / plan

- Directory: `<agentDir>/permissions-audit/` (respects `PI_CODING_AGENT_DIR` → `~/.pi/personal/permissions-audit/`, `~/.pi/work/…`, same for dev agent-dirs).
- File: monthly JSONL shard — `audit-YYYY-MM.jsonl` (from the event's UTC timestamp).
  - Append-only, one JSON object per line: crash-safe, `grep`/`jq`-friendly, old shards archivable by simply deleting them.
  - No auto-prune; shards are small (one line per prompt).
- Record schema (one line each):

  ```json
  {"ts":"2026-09-04T18:43:23.125Z","kind":"ask","session":"<session-id>","cwd":"…","mode":"default","tool":"bash","target":{"command":"gh pr view 123"},"matchedRule":null,"source":null,"outcome":"allow","choice":"Allow for this session","via":"dialog"}
  ```

  - `kind`: `"ask"` (extensible later: `"deny-rule"`, `"floor"` if wanted).
  - `target`: the canonicalized target (command / path / url) — same shape the evaluator saw, post shell-var expansion.
  - `matchedRule`/`source`: set when an explicit ask rule fired; null for baseline asks.
  - `outcome`: `allow` | `deny`; `choice`: verbatim dialog option; `via`: `dialog` | `headless-failclosed` (children/no-UI).
  - PID/host omitted deliberately: shard is per-machine already.
- Hook point: single choke point — `askDecision` in `index.ts` wraps `resolveAsk`; log there, after the outcome is known, for BOTH dialog and headless-failclosed paths.
- Fire-and-forget: wrap in try/catch, swallow failures (an audit error must never alter a permission decision), no buffering needed (appendFileSync per event is fine at ask frequency).
- Follow-on (out of scope here): a mining pass (script or skill) that reads shards → groups by target prefix → proposes `allow` rules with counts, e.g. "gh pr view × 14 this month → suggest `Bash(gh pr view *)`".

## Acceptance criteria

- [ ] Each dialog answer appends exactly one line to the current month shard.
- [ ] Headless fail-closed asks log with `via: "headless-failclosed"`.
- [ ] Forced write failure (read-only dir) leaves the permission decision unchanged.
- [ ] `npm run typecheck` + suite green; new `tests/audit-log.test.ts`.

## Evidence / log

- (empty)
