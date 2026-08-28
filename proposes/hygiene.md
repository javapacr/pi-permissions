# FS6 hygiene PROPOSALS — diffs/checklists only, NOT applied

Prepared by the FS6 builder 2026-08-28. Every item below is a **proposal for the
orchestrator/user to apply at execution time** (execution deferred by user). Facts
verified against live files + pi-permissions source unless marked otherwise.

---

## H1 — prune dead `mcp__plugin_context7…` allow rules (global Claude settings)

**File:** `~/.config/claude/settings.json` → `permissions.allow` (currently 53 entries).

**Proposed diff** — remove exactly two entries:

```diff
   "allow": [
     …
-    "mcp__plugin_context7_context7__query-docs",
-    "mcp__plugin_context7_context7__resolve-library-id",
     …
   ]
```

**Verified dead on the pi side:** no `context7` server exists in any mcp.json
(`~/.pi/agent/mcp.json` = atlassian; `~/.pi/personal/mcp.json` + `~/.pi/work/mcp.json` =
mempalace [+ atlassian]); under the current prefix-mode defaults pi never emits `mcp__…`
tool names (direct tools are `<sanitized-server>_<raw>`, the gateway carries
`input.tool/server` — only the adapter's unused `mcp` prefix mode would emit `mcp__…`
wire names), and pi-permissions' registry canonicalization cannot revive a rule whose
server is unregistered. Caveat before
applying: this file is **shared with Claude Code itself** — if the context7 *plugin* is
still installed there, the rules may be live on the Claude side. Quick check: run
`/mcp` (or check plugins) in Claude Code; if context7 is absent, prune is safe for both.

**⚠ Application method matters — the file is HARDLINKED.** `~/.config/claude/settings.json`
and `~/.claude/settings.json` are the same inode (verified: both inode 23013846). Most
editors' atomic write (tmp+rename) and `sed -i` **replace the inode** — the link breaks and
the two files silently diverge (Claude Code reads `~/.claude/…`; pi-permissions reads
`~/.config/claude/…`). Apply with an in-place write that preserves the inode:

```sh
python3 - <<'EOF'
import json
path = "/Users/reevonr/.config/claude/settings.json"   # same inode as ~/.claude/settings.json
with open(path, "r+") as f:                            # r+ = in-place, link preserved
    d = json.load(f)
    before = len(d["permissions"]["allow"])
    d["permissions"]["allow"] = [r for r in d["permissions"]["allow"]
                                 if not r.startswith("mcp__plugin_context7")]
    f.seek(0); f.truncate(); json.dump(d, f, indent=2); f.write("\n")
    print(f"allow: {before} -> {len(d['permissions']['allow'])}")
EOF
# verify the link survived:
stat -f "inode=%i %N" ~/.config/claude/settings.json ~/.claude/settings.json
```

---

## H2 — `planModeAllowedTools`: located, unused → whole zackify config file dies at retirement

**Location found:** `~/.pi/agent/extensions/permissions.json` (zackify's global config —
NOT a pi-permissions scope; pi-permissions reads `<agentDir>/permissions.json`, one level
up). The file contains exactly two keys:

```json
{
  "protectedPaths": [ …13 entries — see H3… ],
  "planModeAllowedTools": [ "plan_save", "plan_submit", "annotate", "ask_user",
    "subagent", "web_search", "fetch_content", "code_search", "lens_diagnostics",
    "lsp_diagnostics", "lsp_navigation", "ast_grep_search", "todo", "task" ]
}
```

**Verified unused:** zackify's code reads `planModeAllowedMcpServers`, not
`planModeAllowedTools` (research §2.2 quirk); pi-permissions has no plan mode at all (D1 —
plan stays with pi-plan-tools/plannotator). No other reader exists. Also verified: NO
`piClaudePermissions` block in `~/.pi/agent/settings.json` or either profile's settings —
no zackify settings cleanup is owed.

**Proposal — deletion, timing-coupled to retirement:**

```sh
# AT RETIREMENT (zackify still reads protectedPaths from this file while it is live):
rm ~/.pi/agent/extensions/permissions.json
```

Do **not** remove earlier: until zackify+bridge are retired from both profiles, zackify's
live floor still consumes this file's `protectedPaths`. After retirement both keys are dead
(protectedPaths → H3 verdict: covered by built-in defaults).

---

## H3 — protectedPaths migration: **NO-OP** (orchestrator decision 2026-08-28, Option A)

**Charge presumed a migration; verified facts made it counterproductive.** Facts:

1. The live zackify-era list (13 entries) lives in `~/.pi/agent/extensions/permissions.json`
   (H2's file): `~/.gnupg, ~/.gpg, ~/.bashrc, ~/.bash_profile, ~/.profile, ~/.zshrc,
   ~/.zprofile, ~/.config/git/credentials, ~/.netrc, ~/.npmrc, ~/.docker/config.json,
   ~/.kube/config, ~/.pi/agent/auth.json`.
2. pi-permissions `safety.ts#DEFAULT_PROTECTED_PATHS` = **17 entries = the live 13 PLUS
   `~/.ssh`, `~/.aws`, `~/.pi/personal/auth.json`, `~/.pi/work/auth.json`** (strict superset;
   applies whenever no config `protectedPaths` exists — and none does). The two
   profile-auth entries were added in the review fix window (R8, commit `02b0853`):
   both review lanes escalated the per-profile credential gap (work auth.json
   holds bedrock creds) and the orchestrator upheld the addition.
3. Config `protectedPaths` **replaces** the defaults, never merges (`index.ts#reloadState`:
   `loaded.keys.protectedPaths ?? DEFAULT_PROTECTED_PATHS`). Migrating the 13 verbatim
   would *reduce* protection — the no-op verdict below is even stronger post-R8.

**Verdict (orchestrator-approved): no config file.** At retirement, H2's file deletion
completes the story: protection strictly rises (+`~/.ssh`, +`~/.aws`), zero gap window
(defaults bind from the first pi-permissions session), one less hand-maintained file, and
profiles stay subscribed to future default additions.

**watch.ts cross-check (charge requirement):** moot under Option A — no new file. For the
record, a future pi-user config at `<agentDir>/permissions.json` **is** watched
(`watch.ts#watchedConfigFiles` includes `p.piUser`); hot-reload would cover it.

**Known limitation → RESOLVED in the fix window:** the profile-auth gap closed via
R8 (explicit `~/.pi/personal/auth.json` + `~/.pi/work/auth.json` defaults — matcher
handles explicit entries natively; glob support remains absent and parked for OTHER
agent dirs). Parking-lot sync line for the orchestrator (backlog copy):
*"profile-auth floor gap CLOSED 2026-08-28 (R8, explicit defaults; review register R2/R8);
REMAINING parked: glob support in protected-path matching + command-substitution/`..`-in-text
normalization (pinned open in tests/safety.test.ts adversarial table)."*

---

## H4 — probe-dir credential cleanup checklist (deferred to probe-profile retirement)

`~/.pi/tmp/pi-permissions-probe/` currently holds **live credentials** (kept deliberately
until rollout acceptance completes — the headless probe J and any re-run need auth):

| File | Contents | Origin | Action |
|---|---|---|---|
| `auth.json` (0600, 330B) | **3 live provider credentials**: `kimi-coding`, `deepseek`, `zai` | FS0 copy of real auth (dir shipped authless); FS2/3 swapped kimi-only during provider 500s, then back to multi-provider | delete at retirement |
| `auth.kimi-only.json` (0600, 139B) | 1 provider (`kimi-coding`) — swap-era backup | FS2/3 | delete at retirement |
| `models-store.json`, `trust.json`, `sessions/`, `missions/`, `settings.json` | no credentials | — | die with the dir |

**One-liner at retirement (after final acceptance + probe session closed):**

```sh
rm -rf ~/.pi/tmp/pi-permissions-probe
```

Until then: nothing. (FS0 NOTES flagged the auth copy for "delete post-FS6" — this item
tracks it.)
