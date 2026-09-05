# item11 — Parked safety gaps (phase-2 bundle)

**Status:** parked · **Effort:** M–L · **Origin:** NOTES.md parking-lot line; `tests/safety.test.ts` adversarial table; `rules/bash.ts` header

## Problem

Three known matcher-precision gaps, all pinned in tests as OPEN, all exploitable only by adversarial command shapes:

1. Protected-path matching has no glob support (explicit entries only).
2. No command-substitution / `..`-in-text normalization — path-anchored rules can be evaded by text like `$(find ~ -name id_ed25519)`.
3. FS1 matches FULL command text: `| bash` / `> file` continuations ride trailing-`*` entries, and compound commands are not decomposed — piecewise approval is the phase-2 shape.

## Design / plan

Not designed. Deliberately parked as a bundle: each gap needs its own matcher design + adversarial matrix; do not nibble opportunistically. Pins and rationale live in `tests/safety.test.ts` (adversarial table) and the `rules/bash.ts` header.

## Acceptance criteria (per gap, when unparked)

- [ ] Design + adversarial table extension; existing OPEN pins flip to enforced-or-explicitly-scoped.
- [ ] No false-positive regression on the existing rule tables (research-doc table cases stay green).

## Evidence / log

- 2026-08-28 pinned OPEN (R-window); 2026-09-05 consolidated here from the NOTES parking-lot line.
