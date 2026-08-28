# FS6 rollout — PROPOSED orchestrator command sequence (NOT executed)

Prepared by the FS6 builder 2026-08-28. All steps are **user-signal-gated** (execution
deferred). Sandbox note throughout: `pi install` (git) needs a sandbox-off context —
harness tab or user terminal (`trust.json.lock` mkdir EPERM under sandbox, known issue).

## Order rationale (why this sequence)

1. Probes run **pre-install** in the isolated probe profile (live profiles still
   double-load zackify+bridge → their evidence is void per protocol).
2. Install and retirement happen **in the same sitting**: while both stacks are loaded,
   the two ask layers double-prompt (the exact defect this build removes) and two safety
   floors compose unpredictably. The interim state is a bug, not a checkpoint.
3. Hygiene follows retirement (H2's file is live-read by zackify until then).

## 1. Preconditions

```sh
cd /Users/reevonr/Documents/projects/personal/pi-extensions/pi-permissions
git status --short            # expect: clean
npm test && npm run typecheck # expect: 203/203 + clean
```

GitHub repo `javapacr/pi-permissions` created (empty, no auto-init README — the local
README wins on push).

## 2. Push

```sh
cd /Users/reevonr/Documents/projects/personal/pi-extensions/pi-permissions
git remote add origin https://github.com/javapacr/pi-permissions.git
git push -u origin main
```

Dual-account workarounds (AGENTS.md precedent) if push auth fails:
`gh auth switch --user javapacr` (https), or
`GIT_SSH_COMMAND="ssh -o UserKnownHostsFile=~/.pi/tmp/known_hosts_github" git push …`
(ssh; then set the remote to the ssh form).

## 3. Behavioral acceptance — GATE before install

Run `probes/acceptance.md` end-to-end in the harness tab (probe profile). Do not proceed
to install on a partial pass.

## 4. Install ×2 profiles

```sh
PI_CODING_AGENT_DIR=~/.pi/personal pi install git:github.com/javapacr/pi-permissions
PI_CODING_AGENT_DIR=~/.pi/work     pi install git:github.com/javapacr/pi-permissions
```

Auto-adds `git:github.com/javapacr/pi-permissions` to each profile's `packages` (never
hand-add — duplicates). Clone lands in the shared store
`~/.pi/agent/git/github.com/javapacr/pi-permissions`. Future updates: commit+push in the
monorepo repo, then re-run both installs (mempalace model).

## 5. Retire zackify + bridge — SAME SITTING as §4

```sh
PI_CODING_AGENT_DIR=~/.pi/personal pi uninstall @zackify/pi-claude-permissions
PI_CODING_AGENT_DIR=~/.pi/work     pi uninstall @zackify/pi-claude-permissions
PI_CODING_AGENT_DIR=~/.pi/personal pi uninstall git:github.com/javapacr/pi-claude-permissions-bridge
PI_CODING_AGENT_DIR=~/.pi/work     pi uninstall git:github.com/javapacr/pi-claude-permissions-bridge
```

Deterministic fallback if `pi uninstall` balks at a form: edit the two `settings.json`
`packages` arrays by hand (removal is safe — the auto-add duplication trap is about
adding) and verify:

```sh
grep -n "zackify\|permissions-bridge" ~/.pi/personal/settings.json ~/.pi/work/settings.json
# expect: no matches (the new pi-permissions entry itself matches neither pattern)
```

Leftovers that are inert by design: the bridge clone in the git store (unreferenced) and
the npm-store zackify copy — leave them.

## 6. Post-retirement hygiene + config swap

| Item | Action | Source |
|---|---|---|
| H1 | prune dead `mcp__plugin_context7…` rules — **in-place write only** (hardlink!) | `proposes/hygiene.md` H1 |
| H2 | `rm ~/.pi/agent/extensions/permissions.json` | `proposes/hygiene.md` H2 |
| H3 | nothing (no-op verdict) | `proposes/hygiene.md` H3 |
| monorepo `.pi/settings.json` | swap the worker/oracle `subagentOnlyExtensions` dev-tree path → `/Users/reevonr/.pi/agent/git/github.com/javapacr/pi-permissions` (keeps child loading after install; refresh path stays stable) | diff below |
| bridge monorepo repo | mark `pi-claude-permissions-bridge/` dormant/retired in the registry (repo stays as history) | row edit below |
| AGENTS.md | apply the registry row below + retire the zackify npm-list mention | row draft below |

Monorepo `.pi/settings.json` — proposed diff (both occurrences):

```diff
         "extensions": [],
         "subagentOnlyExtensions": [
-          "/Users/reevonr/Documents/projects/personal/pi-extensions/pi-permissions"
+          "/Users/reevonr/.pi/agent/git/github.com/javapacr/pi-permissions"
         ]
```

## 7. Post-install live spot-check (both profiles, one minute each)

Fresh pi session in any dir: startup banner lists `pi-permissions` with **no load errors
and no shortcut-conflict warning**; status bar shows `⏵⏵⏵⏵ Bypass Permissions` + the
`π Na·Nd·Nq` slot; `ctrl+shift+m` cycles (full order); `/permissions` renders picker +
🩺 Diagnostics; one `bash curl --version` blocked by the global deny (if the live global
file still carries it) — or any deny — with rule+source. No tool-registration conflicts
(this extension registers no tools — hooks/commands/shortcut only; coexists with
pi-patty-bg-tasks's `bash` by construction).

## 8. Probe-profile retirement (end of line)

After final acceptance and any re-runs are done:

```sh
rm -rf ~/.pi/tmp/pi-permissions-probe        # credentials die here — proposes/hygiene.md H4
```

---

## AGENTS.md registry row — PROPOSED draft (apply at §4/§6, fill `<sha>`/dates)

New row in the "Registry — runtime extensions with monorepo replacements" table:

```markdown
| pi-permissions (git install) | `pi-permissions/` | both profiles: `git:github.com/javapacr/pi-permissions` | ✓ `<sha>`; enabled <date> — **replaces zackify + bridge** (both retired <date>): Claude-Code-parity permission engine — 4 modes w/ ctrl+shift+m cycling (D1; shift+tab is pi-reserved `app.thinking.cycle`), full rule grammar incl. MCP dual-surface canonicalization + gitignore path globs + `Agent(name)` spawn gating (deny>ask>mode-baseline>allow, D7), dual 6-scope Claude+pi config w/ hot-reload + 🩺 diagnostics (D3/D6), single 5-option ask w/ rule-keyed session cache + `.pi/permissions.local.json` "Always" persistence (D5), read-gated always-on safety floor (15 default protectedPaths, config replaces), bypassPermissions hard startup default (D4), production-support investigation mode w/ readOnlyBash safelist (D2), pi-subagents child mode inheritance + fail-closed ask w/ surface-to-parent reasons (D8, `subagentOnlyExtensions` recipe in monorepo `.pi/settings.json` → git-store path). Acceptance battery: `pi-permissions/probes/acceptance.md`; living doc: `docs/pi-permissions.md` |
```

Concurrent edits in the same file:

- npm-managed packages list: drop `@zackify/pi-claude-permissions` from the enumeration
  line (it no longer loads anywhere).
- Bridge row: change to retired — e.g. append
  `; **retired <date> — superseded by pi-permissions** (repo kept as history; git-store clone inert-unreferenced)`.
- "Pending user-terminal cleanup": add H1 (Claude-settings prune, in-place write caveat)
  and H2 (`rm ~/.pi/agent/extensions/permissions.json`) unless the orchestrator runs them
  itself post-retirement (nothing blocks agent-side `rm` once the bridge is gone).
