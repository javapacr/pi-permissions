# pi-permissions — consolidated acceptance battery (FS6, script of record)

One repeatable orchestrator script covering the FS6 acceptance probes **plus** the
FS2–FS5 regression highlights. Run it in the harness tab (protocol:
`docs/pi-permissions.md` §Probe protocol — probe evidence from live profiles is void).

- Harness tab: Herdr `w0:t4` / pane `w0:p5`, env baked
  `PI_CODING_AGENT_DIR=/Users/reevonr/.pi/tmp/pi-permissions-probe` (settings `{"packages": []}`).
- All interactive prompts below are typed **to the model** in that session; expected
  strings are TUI-visible (dialog titles, block reasons, status slots). JSONL grep is
  not an oracle.
- Setup/teardown are scripted in `probes/acceptance.sh`; manual commands shown here too.

## 0. Unit bar (any terminal)

    cd /Users/reevonr/Documents/projects/personal/pi-extensions/pi-permissions
    npm test && npm run typecheck        # expect: 203/203 + clean

## 1. Seed (or: `./probes/acceptance.sh seed`)

Monorepo-root pi-project scope — `/.pi/permissions.json`:

    cd /Users/reevonr/Documents/projects/personal/pi-extensions
    cat > .pi/permissions.json <<'EOF'
    {
      "permissions": {
        "deny": [
          "Bash(curl *)",
          "mcp__mempalace__mempalace_search",
          "Write(/tmp/never)"
        ],
        "ask": ["Bash(git push *)"]
      },
      "productionSupport": { "readOnlyBash": ["git status"] }
    }
    EOF

(`Write(/tmp/never)` is deliberately invalid — it must surface as a counted issue, never
silently skipped.)

Probe-profile MCP registry — `~/.pi/tmp/pi-permissions-probe/mcp.json` (mempalace static
entry, `lazy` — deny blocks **before** any connection, so nothing actually spawns):

    cat > ~/.pi/tmp/pi-permissions-probe/mcp.json <<'EOF'
    {
      "mcpServers": {
        "mempalace": {
          "command": "/Users/reevonr/.local/share/mise/installs/python/3.13/bin/mempalace-mcp",
          "args": [],
          "lifecycle": "lazy",
          "directTools": ["mempalace_search", "mempalace_diary_write", "mempalace_diary_read", "mempalace_reconnect"]
        }
      }
    }
    EOF

## 2. Launch (probe tab)

    PI_CODING_AGENT_DIR=~/.pi/tmp/pi-permissions-probe pi --no-extensions \
      -e ./pi-permissions \
      -e ~/.pi/agent/npm/node_modules/pi-mcp-adapter \
      -e ~/.pi/agent/npm/node_modules/pi-subagents

**A — startup evidence.** `[Extensions]` lists `pi-permissions` (plus pi-mcp-adapter,
pi-subagents), **zero load errors and NO shortcut-conflict warning** (FS5 pin — a
reserved-key warning here means the ctrl+shift+m rebind regressed). Status bar:
`⏵⏵⏵⏵ Bypass Permissions` (D4 default) and the rules slot
`π 53a·13d·1q ⚠1` — 53a·11d·1q from claude-global + the 2 seeded denies; the seeded
ask `Bash(git push *)` is **byte-identical to the live global ask rule, so it dedupes**
and q stays 1; `⚠1` = the invalid Write spec. If the global file drifted, assert the
*relative* shape: **+2d +0q +⚠1** over the pre-seed baseline while that identity holds
(it becomes +1q only if the global ask spec differs from the seed).

## 3. The battery

**B — bypass + deny blocks (no prompt).**
Prompt: *"Run exactly: bash curl --version. Report the raw outcome."*
→ NO dialog (bypass), tool result blocked:
`Denied by rule Bash(curl *) (from /Users/reevonr/Documents/projects/personal/pi-extensions/.pi/permissions.json).`

**C — ask prompts once per rule, then session-cached.**
Prompt: *"Run exactly: bash git push origin main. Report the raw outcome."*
→ dialog `🔒 Bash(git push origin main)` with the five options
(`Allow once / Allow for session / Always / Deny / Deny for session`) → pick **Allow for session** → command runs (or fails on git's own merits — the permission layer passed it).
Prompt: *"Now run exactly: bash git push origin dev."*
→ **no second dialog** (same rule key `Bash(git push *)`), command proceeds.

**D — production-support: injection + all-prompt + readOnlyBash + allow-not-consulted.**
Press `ctrl+shift+m` ×3 (bypass → default → acceptEdits → production-support).
→ status `🛡 Production Support`; the session shows the injected framing message
starting `[PRODUCTION SUPPORT MODE]` (investigation mode, mutations need approval).
1. Prompt: *"Run exactly: bash touch /tmp/pi-fs6-ps"* → **prompts** (`🔒 Bash(touch /tmp/pi-fs6-ps)`) — allow once.
2. Prompt: *"Run exactly: bash git status"* → **free** (readOnlyBash safelist; exit 128 "not a repository" is git's own — permission passed it).
3. Prompt: *"Read any file in this repo."* → **free** (read-class).
4. Prompt: *"Run exactly: bash echo fs6"* → **still prompts** — the global `Bash(echo *)` allow must be ignored in PS (`ignoreAllow`).

**E — MCP: one rule, both surfaces.**
1. Prompt: *"Call the mempalace_search MCP tool (direct) with a query of your choice."*
→ tool `mempalace_search` blocked: `Denied by rule mcp__mempalace__mempalace_search (from …/.pi/permissions.json).`
2. Prompt: *"Now reach the same tool through the mcp gateway tool: server=mempalace, tool=mempalace_search, any input."*
→ the gateway call blocked with the **same rule + same source**. No mempalace process ever starts (deny precedes execution).

**F — persistence format (FS3 regression).**
`ctrl+shift+m` ×2 (PS → bypass → default). Prompt: *"Create the file /Users/reevonr/.pi/tmp/fs6-scratch.txt containing the single word ok."*
→ dialog `🔒 Write(/Users/reevonr/.pi/tmp/fs6-scratch.txt)` → pick **Always**.
→ `.pi/permissions.local.json` now exists in the monorepo root with
`"allow": ["Edit(//Users/reevonr/.pi/tmp/fs6-scratch.txt)"]` (`//` fs-root anchor; Write
persisted as the governing Edit row). Prompt: *"Overwrite it with the word done."*
→ **free** (persisted rule honored next call, no restart).

**G — hot-reload add/remove (FS5 regression, real fs.watch).**
Note the current `π` counts. From a second shell:

    cd /Users/reevonr/Documents/projects/personal/pi-extensions
    python3 - <<'EOF'
    import json
    p = ".pi/permissions.json"
    d = json.load(open(p))
    d["permissions"]["deny"].append("Bash(whoami *)")
    json.dump(d, open(p, "w"), indent=2)
    EOF

Prompt (same session): *"Run exactly: bash whoami. Report the raw outcome."*
→ **blocked on the very next call**: `Denied by rule Bash(whoami *) (from …)` and the
rules slot ticked `…d+1` (e.g. `π 53a·14d·1q ⚠1`).
Remove it again (`python3` … `.remove("Bash(whoami *)")` + dump), then prompt
*"Run exactly: bash whoami"* once more
→ dialog `🔒 Bash(whoami)` (lazy reload honored the removal; counts restored). Note:
nothing announces rule changes to the model — application is strictly next-call, by design.

**H — /permissions + 🩺 Diagnostics (FS5 regression).**
`/permissions` → title `Select permission mode  (cycle: ctrl+shift+m)`; 4 modes + trailing
`🩺 Diagnostics (mode · rules · issues · children · hot-reload)`. Enter Diagnostics →
sections `🧭 Mode` (origin line, e.g. `set by ctrl+shift+m cycling`), `📜 Rules by source`
(the two seeded denies render in the `.pi/permissions.json` group; the deduped
`Bash(git push *)` ask renders in the **claude-global group** — dedupe attaches the later
source to the earlier occurrence — carrying `(+1 more source)`), `⚠️ Invalid specs` (lists `Write(/tmp/never)` with its message),
`👥 Children (subagents)`, `🔁 Hot-reload` (watched dirs, last load). esc walks back/out.

**I — child deny probe (FS4 regression).**
(Any parent mode; bypass is fine.) Prompt: *"Use the subagent tool with agent=worker, task='Run exactly: bash curl --version. Report the raw outcome.'"*
→ child loads pi-permissions via the monorepo `.pi/settings.json`
`subagentOnlyExtensions` recipe, inherits the parent's mode snapshot, and its bash call
is **blocked with the rule + source** in the child's final result:
`Denied by rule Bash(curl *) (from /Users/reevonr/Documents/projects/personal/pi-extensions/.pi/permissions.json).`
(deny survives even an inherited-bypass child).

**I2 — safety-floor probe (the only gate under the bypass startup default).**
Prompt: *"Read the file ~/.ssh/config and show its contents."* (any mode; bypass is the
interesting one) → tool result blocked:
`Blocked by safety floor: read of protected path ~/.ssh/config. This cannot be overridden by rules or mode.`
Also spot-check the bash surface: *"Run exactly: bash cat ~/.ssh/config"* →
`Blocked by safety floor: bash command references protected path ~/.ssh`.
(R2 fix window CLOSED the textual-evasion variants — `$HOME`/`${HOME}` expansion, long-flag
rm, `//etc` normalization, cwd-relative upward deletes — pinned in tests/safety.test.ts;
command substitution + embedded `..` remain documented-open, parked. R8: also probe
*"Read ~/.pi/work/auth.json"* → same floor block — the per-profile auth files are default-protected now.)

**I3 — sandbox wrap-order probe (review finding R1; run in the probe tab, fresh session).**
Launch variant emulating the WORST-CASE live order (sandbox first, permissions second):

    PI_CODING_AGENT_DIR=~/.pi/tmp/pi-permissions-probe pi --no-extensions \
      -e ~/.pi/agent/git/github.com/javapacr/pi-claude-sandbox \
      -e ./pi-permissions

Prompt: *"Run exactly: bash git push --force origin main. Report the raw outcome."*
→ must be **blocked with `Denied by rule Bash(git push --force *) (from ~/.config/claude/settings.json).`** — i.e., the deny matched the UNWRAPPED command text. If the reason
instead shows a `sandbox-exec … -c 'git push …'` wrapper or the command runs, extension
order is evaluating wrapped text → R1 has regressed (post-install: re-check §4.5 reorder).
Relaunch with the fixed order (`-e ./pi-permissions -e ~/.pi/agent/git/…/pi-claude-sandbox`)
→ same block expected. Both orders must block. (The sandbox extension may log wrap
notices; only the DENY REASON TEXT is the oracle here.)

**J — headless spot-check (optional; orchestrator/user terminal — builder sandbox
blocks providers).**

    cd /Users/reevonr/Documents/projects/personal/pi-extensions
    PI_CODING_AGENT_DIR=~/.pi/tmp/pi-permissions-probe pi --no-extensions \
      -e ./pi-permissions -p "Run exactly: bash curl --version. Report the outcome verbatim."

→ output contains `Denied by rule Bash(curl *) (from …)` (bypass default + deny; no hang).

## 4. Teardown (or: `./probes/acceptance.sh teardown`)

    rm /Users/reevonr/Documents/projects/personal/pi-extensions/.pi/permissions.json
    rm /Users/reevonr/Documents/projects/personal/pi-extensions/.pi/permissions.local.json
    rm -f /Users/reevonr/.pi/tmp/fs6-scratch.txt /tmp/pi-fs6-ps
    rm ~/.pi/tmp/pi-permissions-probe/mcp.json        # keep auth.json until probe-profile retirement (see proposes/hygiene.md H4)

Close the probe session: `esc` then `ctrl+d` (herdr send-keys on pane `w0:p5`); confirm
zsh is foreground via `herdr pane process-info --pane w0:p5`.

**Acceptance:** every expected string observed with pi-permissions (and only it, plus the
adapter/subagents runtime extensions) loaded; unit bar green; startup warning-free.

---

## Addendum 2026-08-30 — dialog v2 (scoped persistence)

The probe runs above were executed against the original dialog
(`Allow once / Allow for session / Always / Deny / Deny for session`).
The dialog was revised the same week by user decision (D5 revision): it is now
`Allow now / Allow for this session / Allow in project directory /
Allow in global directory / Deny`. Where a probe says **Allow once** read
**Allow now**; **Allow for session** → **Allow for this session**; **Always**
→ the scoped option matching the intended target (**Allow in project
directory** writes the committed `.pi/permissions.json`, **Allow in global
directory** writes `<PI_CODING_AGENT_DIR|~/.pi/agent>/permissions.json`).
Probe F's persisted file is therefore `.pi/permissions.json` (or the agent-dir
file), not `.pi/permissions.local.json`. `persistTarget: "claude-local"` no
longer exists. Future probe runs should use the new option names verbatim.
