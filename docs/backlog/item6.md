# item6 — PS safelist rollout: `kaf` / `aws`

**Status:** ready (partially superseded — see Evidence) · **Effort:** S · **Origin:** backlog workspace 2026-09-05 (was plan-production-support-safelist.md)

## Problem

In 🛡 Production Support, a few trusted read-only-ish commands (`kaf`, `aws`) should run without prompting. **No code needed** — the mechanism exists: `productionSupport.readOnlyBash`.

## Design / plan (as authored)

- Config key `productionSupport.readOnlyBash`, root level of any **pi-\*** scope file: `<agentDir>/permissions.json`, `<cwd>/.pi/permissions.json`, `<cwd>/.pi/permissions.local.json`. Parsed in `extractPiKeys`, consumed via `matchesReadOnlyBash` in `index.ts` (parent + child paths), matched with Claude bash-glob semantics (`rules/bash.ts`): `kaf *` = word-boundary prefix (matches `kaf`, `kaf topic list`, …), `kaf:*` equivalent, no star = exact.
- Order note: rules still beat the safelist; allow rules are ignored in 🛡 (`ignoreAllow`) but the safelist is not — it is the 🛡-specific allow channel.
- Merge: last-write-wins across pi-user → pi-project → pi-local (a project file defining the key replaces the user's list wholesale — same replace-semantics caveat as `protectedPaths`, see item7).
- Rollout config: `{"productionSupport": {"readOnlyBash": ["kaf *", "aws *"]}}` — personal first (`~/.pi/personal/permissions.json`), work on demand. Agent cannot write `~/.pi/*` outside tmp — apply via pane or user terminal.
- `aws *` is broad (includes destructive subcommands like `aws s3 rm`); if that feels loose later, narrow to explicit prefixes (`aws sts get-caller-identity`, `aws s3 ls *`, `aws ec2 describe-*`).

## Acceptance criteria

- [ ] `kaf --version` runs free (no dialog); `aws --version` runs free; `echo probe-ok` still prompts; `head -c 40 ~/.ssh/known_hosts` still floor-blocked.
- [ ] Verified in a dev agent-dir pane (`~/.pi/tmp/pi-perms-dev/` with settings → local dir packages, permissions.json above, copied auth/models/sandbox files; `pi -e <sandbox> -e <permissions>` → switch to 🛡) — no real-profile writes during verification.

## Evidence / log

- 2026-09-05 (plan authored): blocked on the in-flight `/permissions`-toggle + icon pass sharing the same verify pane; config file already staged in `~/.pi/tmp/pi-perms-dev/permissions.json`.
- 2026-09-05 frictionless-read rollout (user-directed) landed granular `readOnlyBash` lists in BOTH profile settings (personal 81 / work 109 entries; work = superset adding kubectl read verbs + kaf read subcmds; kaf gotcha: cobra globals must TRAIL the subcommand). Mutator prefixes deliberately excluded (kaf produce/config/topic-create/set-config, group commit/delete; `aws` absent). **Residual decision:** `aws` granularity (broad `aws *` vs explicit prefixes) and whether personal needs kaf — the item shrinks to that decision + verification.
