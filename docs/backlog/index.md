# pi-permissions — backlog

One item per file (`item<N>.md`), numbered by priority (author order for item1–7, then cross-cutting items). The Status column is the truth; item files carry problem/design/acceptance/evidence. Build history (FS0–FS5) lives in the monorepo's `docs/pi-permissions-backlog.md` — this board is the operational backlog going forward.

| Item | Title | Status | Effort |
|---|---|---|---|
| [item1](item1.md) | `/permissions on\|off` runtime toggle | in-flight (paused: pi 0.85.0 toolchain) | M |
| [item2](item2.md) | Remove dead export `stringArrayOrUndefined` | ready | S |
| [item3](item3.md) | Ask audit log (JSONL, monthly shards) | ready | M |
| [item4](item4.md) | Subagent inert gate (`PI_SUBAGENT_CHILD=1`) | ready | M |
| [item5](item5.md) | Per-mode color in footer status slot | ready | S–M |
| [item6](item6.md) | PS safelist rollout: `kaf`/`aws` | ready (partially superseded) | S |
| [item7](item7.md) | `protectedPaths`: extend, not replace | ready (safety-relevant) | S |
| [item8](item8.md) | FS6 rollout execution (install ×2, retire zackify+bridge) | user-gated | M |
| [item9](item9.md) | R5: config self-modification under acceptEdits | needs-design | L |
| [item10](item10.md) | Upstream pi-core filing: intercom `before_agent_start` bypass | optional | S |
| [item11](item11.md) | Parked safety gaps (phase-2 bundle) | parked | M–L |
| [item12](item12.md) | Script invocation caps (exfil-loop defense-in-depth) | ready | S |

## Done (recent)

- [x] 2026-09-05 Intercom PS entry framing — d1aa10b (root cause: pi-core consumes `before_agent_start` only in `prompt()`; `turn_start(0)` steer fix; live-probed, oracle PASS ×8) — upstream gap tracked as item10
- [x] 2026-09-05 `⏭` bypass glyph (was `⏵⏵⏵⏵`) — 506d5aa
- [x] 2026-09-05 Frictionless-read safelist — `productionSupport.readOnlyBash` in both profile settings (personal 81 / work 109 entries) — shrinks item6
- [x] 2026-09-04 P1: judge sandbox-stamped original command; falsifiable floor reasons — 8dc6868
- [x] 2026-09-04 Global-config probe — claude-global rules verified × 4 modes via `/permissions` picker
- [x] 2026-08-30 Dialog v2 scoped persist (D5 revision) — c98eb6a

## Parking lot (explicitly out of scope until further notice)

`/permissions` rule-editor UI · `Tool(param:value)` matching · `Agent(model:…)` gating · child ask-relay to parent via intercom (supersedes D8 fail-closed degradation) · live child mode tracking (D8 ships snapshot-at-spawn) · AST bash matching · pi-mcp-adapter brokered-approval claim · `auto`/`dontAsk` modes · mode persistence across restarts
