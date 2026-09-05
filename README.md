# pi-permissions

Claude-Code-parity permission engine for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent): the full Claude rule grammar (`Bash(glob)`, `Read/Edit/Write(path)`, `WebFetch(domain:…)`, `mcp__server__tool`, `Agent(name)`), four permission modes, dual-source config (your existing `.claude/settings.json` scopes **and** pi scopes, hot-reloaded live), one single-ask UX with session/persistent memory, an always-on safety floor, and pi-subagents child enforcement (mode inheritance + spawn gating).

pi has no native permission surface — everything here lives in the extension `tool_call` hook. One engine replaces the two-extension stack (`@zackify/pi-claude-permissions` for modes + `pi-claude-permissions-bridge` for rules) and fixes its defects: no double-prompt, no dead `mcp__*` rules, path-granular file rules, read-gated secrets, headless fail-closed.

- Build plan + settled decisions → `../docs/pi-permissions-backlog.md` (monorepo)
- Research basis → `../docs/permissions-deep-research.md` (monorepo)
- Per-feature-set engineering detail → `NOTES.md`
- Acceptance battery → `probes/acceptance.md`

## Modes

Cycle with **`ctrl+shift+m`** (or `/permissions`). Order: `default → acceptEdits → production-support → bypass`.

| Mode | Status | Behavior |
|---|---|---|
| `default` | ⏵ | Reads free; every other tool prompts unless an allow rule matches |
| `acceptEdits` | ⏵⏵ | Write/edit auto-allowed (minus deny/ask rules + safety floor); rest per `default` |
| `production-support` | 🛡 | Investigation mode: reads + safelisted read-only bash free; **everything else prompts**; investigation framing injected into the model's context |
| `bypassPermissions` | ⏭ | **Startup default.** Everything passes except deny/ask rules + safety floor |

**Invariant: `deny > ask > mode baseline > allow`.** Deny rules and the always-on safety floor block in *every* mode, including bypass; ask rules prompt in *every* mode, including bypass. Allow rules are consulted only where they change the outcome — `production-support` skips the allow pass entirely (investigations must not be broadened by pre-existing allows).

Composition matrix (as unit-pinned):

| Mode | deny | ask | allow rule | unmatched, non-free |
|---|---|---|---|---|
| `bypassPermissions` | block | prompt | moot | pass |
| `default` | block | prompt | pass | prompt |
| `acceptEdits` | block | prompt | pass | Edit/Write pass; else prompt |
| `production-support` | block | prompt | **not consulted** | prompt (readOnlyBash + free set exempt) |

Free in every non-bypass baseline: read-class tools (`read`, `grep`, `find`, `ls` — all canonicalize to `Read`) plus `todo` and `ask_user_question`.

### Keyboard shortcut — why not Shift+Tab

pi 0.84.3 binds `shift+tab` natively (`app.thinking.cycle`) and places it on the extension-conflict RESERVED list — an extension registering it is silently dropped with a startup warning, and `registerShortcut` has no override flag. The cycle key is therefore **`ctrl+shift+m`** (mnemonic: *mode*; verified free across pi's entire builtin keymap). The `/permissions` picker title carries the same hint.

### Mode resolution at startup

`--dangerously-skip-permissions` (forces bypass) > `--permission-mode <mode>` flag > `defaultMode` config key > hard default `bypassPermissions` (both flags are checked in that order; when both are passed, bypass wins). There is **no persistence across restarts** — a deliberate choice (predictable sessions; pin with `defaultMode` when wanted). Changing mode clears the session ask-cache.

### production-support specifics

- On mode entry, a one-shot `before_agent_start` message injects investigation framing (production environment; reads free; no mutations without approval; prefer read-only; report findings before acting). Leaving the mode injects a corresponding "ended" message.
- `productionSupport.readOnlyBash` (pi config key): safelist of read-only bash commands that run without prompting — entries are Claude bash-glob strings, optionally wrapped as `Bash(git status)`.

## Rule grammar

Rules are Claude-format strings in `allow` / `deny` / `ask` lists. Evaluation is first-match per list, composed as `deny → ask → mode baseline → allow` (see invariant above).

| Spec form | Matches | Notes |
|---|---|---|
| `Bash(npm run *)` | `npm run build`, `npm run test -- --watch`, and bare `npm run` | trailing `*` (or `:*`) = Claude prefix semantics incl. the bare prefix |
| `Bash(ls *)` vs `Bash(ls*)` | `ls *` → `ls` + args only; `ls*` → also `lsof`, `lsblk`… | glued `*` = `^ls.*`; mid-`*` = `.*`; no glob = exact |
| `Read`, `Edit`, `Write`, `WebFetch`, `WebSearch`… | the whole tool | bare tool names |
| `Read(.env)` / `Edit(src/**)` / `Read(~/.ssh/config)` | gitignore-style path globs | see path anchors below |
| `WebFetch(domain:example.com)` | `example.com` apex only | `*.example.com` = subdomains (no apex); `example.*` = dot-bounded tail; `domain:*` = all; comma lists OR |
| `mcp__mempalace` | the whole MCP server (any tool) | gateway meta actions canonicalize here |
| `mcp__mempalace__mempalace_search` | one MCP tool — **on both surfaces** | see MCP canonical form |
| `mcp__mempalace__*` | tool glob within a server | literal-prefix match |
| `Agent(name)` | spawning the named subagent | bare `Agent` = the whole subagent tool |
| `*` / `mcp__*` | whole-tool globs | **deny/ask only** (an allow-everything glob is a foot-gun) |

**Invalid or unknown specs are never silently skipped** — they surface as counted issues (`⚠N` in the status bar, full list in `/permissions` → 🩺 Diagnostics). Examples that count as issues: `Write(/path)` (see below), `Tool(param:value)` parameter matching, `Agent(*)`, specs on unknown tool names.

### Path-rule anchors (gitignore-style)

| Prefix | Anchored at |
|---|---|
| `//abs/path` | filesystem root (the only form that re-matches an absolute path from *any* scope) |
| `~/…` | home directory |
| `/…` | the scope's anchor dir (claude-project/local → project root; claude-global/pi-user → home; pi-project/local → cwd) |
| `./…` | cwd |
| `bare/path` | any depth for **deny/ask** rules and single bare names (no `/`); cwd-anchored for multi-segment **allow** rules (e.g. `Edit(src/**)`) |

`*` = one segment, `**` = any depth; a trailing `/**` (or bare `/`) also matches the named root itself. Deny/ask path rules get any-depth matching for cwd-relative patterns with a leading literal segment (Claude's depth asymmetry — a secret pattern must not be escaped by running from a subdirectory).

### The Read/Edit/Write matrix

Edit is the governing row for file *mutation*; Read rules guard *reading*:

- **Edit rules govern Edit AND Write** (a `write` tool call canonicalizes to `Write`, which Edit rules match).
- **Read deny/ask also blocks Edit/Write on that path** — including creating it (you may not write your way around a read deny).
- **Edit allow also grants Read** on that path.
- Bare `Write` is a valid whole-tool rule; **`Write(path)` specs are rejected** (counted issue) — they are never consulted, so accepting them would be a silent no-op lie.

### MCP canonical form — one rule, both surfaces

pi exposes MCP twice: **direct tools** (first-class tools named e.g. `mempalace_search`) and the **gateway tool** (`mcp` with `input.tool`/`input.server`). Both canonicalize to the same name — `mcp__<server>__<raw tool name>` — via a registry built from your `mcp.json` configs + the pi-mcp-adapter cache. So **one rule covers both surfaces**:

- `deny: ["mcp__mempalace__mempalace_search"]` blocks the direct tool *and* the gateway call `{server: "mempalace", tool: "mempalace_search"}`.
- Gateway meta actions: `connect` / `instructions` / a bare `server` input → `mcp__<server>`; `search` without a server filter, server-less auth actions, server-less list/`status` → the whole gateway tool (matched by bare `mcp` rules and deny-`*`).
- Unregistered direct tools fall back to a name-split heuristic (visible in the ask-dialog title, which always shows the canonical name).

## Configuration — six scopes, one merged rule set

| Scope | File | Notes |
|---|---|---|
| claude-project | `<cwd>/.claude/settings.json` | your existing Claude Code project rules |
| claude-local | `<cwd>/.claude/settings.local.json` | gitignored Claude local rules |
| claude-global | `~/.config/claude/settings.json` | shares rules with Claude Code itself |
| pi-user | `<agentDir>/permissions.json` | `<agentDir>` honors `PI_CODING_AGENT_DIR`; default `~/.pi/agent/permissions.json` |
| pi-project | `<cwd>/.pi/permissions.json` | |
| pi-local | `<cwd>/.pi/permissions.local.json` | hand-editable machine-local scope (dialog persistence writes pi-project / pi-user — see below) |

Rules live under `"permissions": { "allow": […], "deny": […], "ask": […] }` (top-level arrays tolerated). Claude and pi scopes are merged into **one rule set: union + dedupe, with deny-dominance** — *deny anywhere beats allow anywhere; ask beats allow; first-match within a list* (decision D7). Source order affects only display and persistence targeting, never evaluation.

> **Shared-source coupling:** the claude-global scope is hot-reloaded live — an edit made by Claude Code itself (including its own "always allow" persistence) applies to your **running** pi sessions from the next tool call, and clears the session ask-cache. Direction is fail-safe (extra rules only), but the coupling is real.

### pi-scope config keys

Pi scope files may additionally carry these root-level keys (merged per key in order user → project → local, later wins):

```jsonc
// ~/.pi/agent/permissions.json  (or <agentDir>, or .pi/permissions.json variants)
{
  "permissions": { "allow": ["Bash(git status)"], "deny": [], "ask": [] },
  "defaultMode": "default",                     // one of the 4 modes; startup default when no flag
  "protectedPaths": ["~/.config/sops/age/keys.txt"], // REPLACEs the built-in defaults — see Safety floor
  "productionSupport": { "readOnlyBash": ["git status", "git log", "Bash(kubectl get *)"] },
  "children": { "agentModes": { "worker": "bypassPermissions" } }
}
```

## Ask UX — one prompt, rule-keyed memory

A single dialog replaces the old double-prompt:

```
🔒 Bash(git push origin main)
  Allow now · Allow for this session · Allow in project directory · Allow in global directory · Deny      (esc = deny once)
```

Bash titles carry a risk annotation (⚠️ DANGEROUS recursive-delete-outside-project / chmod -R …; 🚫 CATASTROPHIC mkfs/dd/fork-bomb …).

- **Session cache is keyed on the matched rule** (or the exact target when no rule matched), not on the raw input — one approval of `Bash(git push *)` covers `origin main` and `origin dev` for the session. Cache clears on mode change, session start, and any watched-file rule edit.
- **"Allow in project directory" persists an allow rule** to the committed `.pi/permissions.json`; **"Allow in global directory"** persists to `<agentDir>/permissions.json` (honors `PI_CODING_AGENT_DIR`, default `~/.pi/agent/permissions.json` — the loader's own pi-user path, so the rule reloads in every later session). Both are decision D5 (revised 2026-08-30 by user choice: the dialog may write the committed project config). Writes are atomic (tmp+rename) and effective from the next call with no restart. Persisted path specs use the `//` fs-root anchor (`Edit(//Users/you/project/src/foo.ts)`) so they re-match from any scope; `Write` approvals persist as `Edit` (the governing row). Unpersistable targets (WebFetch without a hostname — no narrower rule than whole-tool exists — plus whole-gateway `mcp` and registry-unresolved fallbacks) get a warning and session-only allow.
- **A scoped persist under a matched *ask* rule is session-honest**: the persisted allow cannot override your ask rule in later sessions (`ask > allow` globally) — the choice holds for this session; the ask rule is never edited or removed.
- **Headless (`pi -p`, no UI) fails closed** with an instructive reason naming the spec, the mode, and the unblock paths (add an allow rule / restart in bypass). Ask dialogs can never hang a headless run.

## Child policy (pi-subagents)

Children have no TUI, so they can never prompt. Policy (decision D8):

- **Mode inheritance — snapshot at spawn.** When the parent allows a `subagent` spawn, the child's effective mode is injected via pi-subagents' `extensionBindings` channel (`pi-permissions/1` namespace → `PI_SUBAGENT_EXTENSION_BINDINGS` in the child). The snapshot is taken at spawn and never live-tracked.
- **Resolution order** (same resolver both sides): config `children.agentModes[agent]` > agent-definition frontmatter `permissionMode` > inherited snapshot > **rules-on-bypass floor** (deny + safety floor + ask-as-fail-closed enforced, everything else allowed). Flags and `defaultMode` are ignored in children.
- **Ask degrades to fail-closed**, with a reason directing the model to surface the request:

  > `Blocked by child permission policy: Bash(node --version) requires approval under the parent session's Production Support mode (subagent sessions cannot prompt). Surface this request to the parent session in your final result.`

  Deny rules block with the normal rule+source reason — in every child mode, including inherited bypass.
- **Per-agent overrides keep workers usable** while the parent investigates: pin `worker` to `bypassPermissions` via `children.agentModes` or frontmatter `permissionMode: bypassPermissions`; rules still apply (deny survives the override).
- **Parent-side `Agent(name)` gating**: the parent's hook evaluates the spawn itself — deny blocks the spawn, ask prompts the parent, allowed spawns carry the mode injection. Bare `Agent` rules govern the whole subagent tool (valid under any action, including allow).
- **Perf-opted children** (`extensions: []` agent overrides) load the engine child-only via pi-subagents' `subagentOnlyExtensions`:

  ```jsonc
  // <project>/.pi/settings.json
  {
    "subagents": {
      "agentOverrides": {
        "worker": {
          "extensions": [],
          "subagentOnlyExtensions": ["<path-to-pi-permissions>"]
        }
      }
    }
  }
  ```

  The child then enforces rules + floor even when the parent session runs no permission extension (floor semantics — no inheritance available).
- Children run **without watchers** — per-spawn processes read fresh state at startup; the mode snapshot stays fixed for the process. `workflowScript`-spawned children receive no automatic injection (pass `extensionBindings` explicitly per spawn if needed).

## Status bar, hot-reload, diagnostics

Two footer slots:

- `permissions` — mode icon + label, e.g. `🛡 Production Support`
- `permissions-rules` — `π 53a·13d·1q` (allow·deny·ask counts), plus `⚠1` when invalid specs were counted

**Hot-reload**: the session watches all nine inputs — the six rule/config scopes above plus the MCP registry inputs (`<agentDir>/mcp.json`, `<agentDir>/mcp-cache.json`, `<cwd>/.pi/mcp.json`). Any change **applies from the next tool call** — no restart, no prompt; rule edits also clear the session ask-cache (a removed rule must not keep honoring old approvals) and rebuild the MCP registry. Directories that don't exist yet are covered by watching their nearest existing ancestor (creation of `.pi/` in a bare project fires); atomic tmp+rename writes are seen because directories, not files, are watched.

**`/permissions`** keeps the 4-mode picker primary with a trailing **🩺 Diagnostics** entry (paged, esc = back):

- 🧭 Mode — active mode + origin (`set by --permission-mode flag` / config / hard default / cycling / picker)
- 📜 Rules by source — the full rule table grouped by source file, with `(+N more source)` provenance on deduped rules
- ⚠️ Invalid specs — every rejected spec with file + message + count
- 👥 Children — agentModes overrides, inheritance channel state, floor, ask degradation
- 🔁 Hot-reload — watched dirs, pending change, last load time

## Always-on safety floor

Non-overridable — by rules, modes, or dialog choices — and runs before deny/ask/allow:

- **Catastrophic patterns**: `mkfs.*`, `dd if=`, raw device writes (`> /dev/sda|nvme`), fork bombs, `sudo` forms.
- **Critical `rm -rf`**: recursive force-delete of `/`, `~`, and critical system dirs (`/bin`, `/etc`, `/usr`, `/var`, …), including behind `sudo`.
- **protectedPaths — read-gated** (the never-gated-read hole, fixed): bash commands referencing a protected path *and* Read/Edit/Write calls targeting one are blocked in every mode.

The built-in defaults: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.gpg`, `~/.bashrc`, `~/.bash_profile`, `~/.profile`, `~/.zshrc`, `~/.zprofile`, `~/.config/git/credentials`, `~/.netrc`, `~/.npmrc`, `~/.docker/config.json`, `~/.kube/config`, `~/.pi/agent/auth.json`, `~/.pi/personal/auth.json`, `~/.pi/work/auth.json` (the last two cover the per-profile credential files — profiles run with their own `PI_CODING_AGENT_DIR`). The floor reasons about shell-variable-expanded text (`$HOME`, `${HOME}`, `$USER`), long-flag rm spellings (`--recursive --force`), normalized absolute targets (`//etc`, `/etc/../etc`), and cwd-relative upward deletes that reach a critical directory.

Configuring `protectedPaths` **replaces** this list (no merge) — if you add custom paths, re-list the defaults you want to keep. Known limitations (parking lot): command substitution (`$(…)`) and `..`-segments inside expanded path-like text are not normalized (no shell evaluation in the floor — the adversarial test table in `tests/safety.test.ts` pins exactly which forms are closed vs open); protected-path matching is exact/prefix (no glob patterns — an explicit entry per agent dir is required); `rm -rf /var/*` (globbed critical dir) is not floor-blocked; no bash wrapper-stripping or compound piecewise approval (full command text is matched).

## Install

```sh
# per profile (install auto-adds the settings entry — never add it by hand):
PI_CODING_AGENT_DIR=~/.pi/personal pi install git:github.com/javapacr/pi-permissions
PI_CODING_AGENT_DIR=~/.pi/work     pi install git:github.com/javapacr/pi-permissions
```

Uninstall = remove the `git:github.com/javapacr/pi-permissions` entry from that profile's `packages`. Do **not** run alongside `@zackify/pi-claude-permissions` or `pi-claude-permissions-bridge` — retire them in the same sitting (this extension replaces both; see `proposes/rollout.md`).

## Dev

```sh
npm install
npm test          # node:test, native TS type-stripping — node >= 22.6 (developed on 26)
npm run typecheck # tsc --noEmit
```

Runtime imports are `import type`-only from `@earendil-works/pi-coding-agent` plus `node:*` builtins; deps are dev-only. Relative specifiers carry explicit `.ts` extensions.

Attribution: seed fork of `@zackify/pi-claude-permissions` v1.0.6 (MIT, © 2026 Zach) with the `pi-claude-permissions-bridge` engine grafted in — see NOTICE and LICENSE. `reference/` preserves the bridge originals (excluded from tsc, never imported).

## Sandbox original-command contract (pi-claude-sandbox)

pi-claude-sandbox stamps the user's original bash command under
`Symbol.for("pi-claude-sandbox.original-command")` on the tool input BEFORE overwriting
`input.command` with the sandbox wrap; the canonicalizer prefers that stamp so rules and
the always-on safety floor judge the user's command regardless of tool_call listener
timing (the two listeners race). RTK and pi-mise also rewrite commands and are
stamp-unaware — benign today: neither introduces protected-path text.
