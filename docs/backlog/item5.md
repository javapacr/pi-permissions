# item5 — Per-mode color in footer status slot

**Status:** ready · **Effort:** S–M · **Origin:** backlog workspace 2026-09-05 (was plan-footer-color.md)

## Problem

The mode entry in the status bar is plain text; the current mode should be readable at a glance (esp. 🛡 vs bypass).

## Design / plan

Palette (proposal):

| Mode | Glyph | ANSI color |
|---|---|---|
| Default | `⏵` | green (32) |
| Accept Edits | `⏵⏵` | cyan (36) |
| Production Support | `🛡` | magenta (35) |
| Bypass Permissions | `⏭` | red (31) — danger |
| Permissions Off (item1) | `⊘` | dim/gray (90) |

Open question (resolve FIRST): `ctx.ui.setStatus(key, text)` feeds the built-in footer (`footerDataProvider.setExtensionStatus` → footer component). Whether raw ANSI SGR sequences in `text` survive rendering or break width measuring must be checked in pi-tui (`footer.js` / `Text` component: ANSI-aware width vs raw passthrough).

- If ANSI passes through: wrap only the status text, reset (`\x1b[0m`) included, keep the plain string in `getModeMeta().status` and compose the colored string in `updateStatus()` (single place).
- If ANSI is stripped/mangled: fall back to (a) a themed footer factory via `ctx.ui.setFooter` (extensions can replace the footer — heavier), or (b) drop the color ask with a note. Do not hand-roll width-measuring hacks.

## Acceptance criteria

- [ ] All four modes + off state render in their color in a live pane; no layout drift.
- [ ] `NO_COLOR`/non-TTY contexts degrade to plain text (guard: only colorize when the UI is interactive).
- [ ] Existing tests assert on the plain (uncolored) strings via a `statusText()` helper so tests don't embed escapes.

## Evidence / log

- (empty)
