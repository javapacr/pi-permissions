# item9 — R5: config self-modification under acceptEdits

**Status:** needs-design · **Effort:** L (design first) · **Origin:** monorepo backlog R5 (accepted follow-up, post-rollout); NOTES.md parking-lot line

## Problem

An agent can edit its own permission config: `.pi/permissions.local.json` is hot-reload-visible, so a model (or a prompt-injected turn) can strip its own deny rules or add self-allows; `.pi/agents` frontmatter (`permissionMode`) can grant bypass. Under `acceptEdits` the file edit itself does not even prompt. Parity-with-today is acknowledged (zackify had the same hole) — this is hardening, not a regression fix.

## Design / plan

None yet — needs a design pass. Candidate directions to weigh (not commitments):

- Treat pi-config scope files as write-gated/protected for the agent while keeping human edits free.
- Require an elevated mode (PS/bypass) for config writes; prompt otherwise even under acceptEdits.
- Out-of-band persistence (dialog-only writes) so the agent never needs raw file access.
- Ask audit log (item3) as the detection half.

## Acceptance criteria

- [ ] Design doc with a chosen mechanism + explicit non-goals, reviewed by the user.
- [ ] Adversarial tests: agent-initiated writes to `.pi/permissions.local.json` / `.pi/permissions.json` / `.pi/agents` frontmatter cannot relax the agent's own enforcement.
- [ ] Human workflows (dialog persistence, hand editing) unbroken.

## Evidence / log

- 2026-08-28 accepted as post-rollout follow-up (parity-with-today noted).
