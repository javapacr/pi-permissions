# item2 — Remove dead export `stringArrayOrUndefined`

**Status:** ready · **Effort:** S · **Origin:** backlog workspace 2026-09-05 (Knip-flagged; re-verified dead 2026-09-05)

## Problem

`modes.ts:72` exports `stringArrayOrUndefined(value: unknown): string[] | undefined` with zero references anywhere in the repo (verified 2026-09-05: only the definition matches). Knip flags it; dead export surface invites accidental use.

## Design / plan

Delete the function; run gates. No deprecation shim — it was never a contracted API.

## Acceptance criteria

- [ ] Export gone from `modes.ts`; `grep -rn stringArrayOrUndefined --include='*.ts'` → zero matches.
- [ ] `npm run typecheck` + `npm test` green.

## Evidence / log

- 2026-09-05 verified dead (grep: definition-only match at modes.ts:72).
