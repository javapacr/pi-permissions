# item8 — FS6 rollout execution (install ×2, retire zackify+bridge, hygiene)

**Status:** user-gated (probes are agent-runnable pre-gate; install/uninstall need user terminal / sandbox-off) · **Effort:** M — one sitting · **Origin:** monorepo backlog FS6; runbook of record `proposes/rollout.md` (2026-08-28)

## Problem

Both profiles still load zackify + bridge from the shared dir; monorepo sessions additionally load pi-permissions via the project `.pi/` layer — the interim double-load is "a bug, not a checkpoint" (two ask layers compose unpredictably). Profile-wide enablement + retirement is fully prepared but user-signal-gated.

## Design / plan (summary — full runbook: `proposes/rollout.md`)

1. Preconditions: clean tree; `npm test && npm run typecheck` green.
2. Push (remote: ssh alias `github-javapacr`).
3. **GATE — do not install on a partial pass:** behavioral acceptance battery `probes/acceptance.md` end-to-end in the isolated probe profile (agent-runnable).
4. Install ×2: `PI_CODING_AGENT_DIR=~/.pi/personal|~/.pi/work pi install git:github.com/javapacr/pi-permissions` (never hand-add the packages entry — duplicates).
5. ⚠ **MANDATORY reorder** (R1 P0): move the pi-permissions entry BEFORE `git:github.com/javapacr/pi-claude-sandbox` in BOTH profiles' `packages` — the sandbox wrap mutates `input.command`; a late load silently kills anchored bash rules. Python verify one-liners in runbook §4.5.
6. Retire zackify + bridge — SAME SITTING as install (interim double-load = duplicate flags/prompts/status). Deterministic fallback + rollback line: runbook §5.
7. Hygiene (`proposes/hygiene.md`): H1 prune dead `mcp__plugin_context7…` rules from global Claude settings — ⚠ HARDLINKED file, in-place `r+` write only (inode preserved), check the context7 plugin first; H2 `rm ~/.pi/agent/extensions/permissions.json` (only after retirement — zackify reads its protectedPaths until then); H3 no-op (defaults ⊃ live list, verified); H4 `rm -rf ~/.pi/tmp/pi-permissions-probe` (holds live credentials).
8. Monorepo `.pi/settings.json`: worker/oracle `subagentOnlyExtensions` dev-tree path → git-store path; stale-clone check (`rev-parse HEAD` == pushed sha).
9. Post-install live spot-checks (runbook §7) incl. one wrapped-command probe (catches an R1 reorder miss instantly) + registry row application (draft in runbook).

## Acceptance criteria

- [ ] `probes/acceptance.md` battery: full pass pre-install.
- [ ] Both profiles: only pi-permissions loaded; zero zackify/bridge references in settings.
- [ ] packages-order check prints `True` for both profiles.
- [ ] H1–H4 applied; probe-dir credentials destroyed.
- [ ] AGENTS.md registry row + monorepo docs updated.

## Evidence / log

- 2026-09-05: monorepo sessions live via the project `.pi/` layer (user attested); profile `packages` entries still absent — this item executes the swap.
