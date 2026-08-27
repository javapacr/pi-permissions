/**
 * `Agent(name)` rule matching for subagent spawn gating.
 * TODO(FS1) — filled by the rule-engine core; see
 * docs/pi-permissions-backlog.md §FS1.
 */
export function matchAgentRule(_pattern: string, _agentName: string): boolean {
  throw new Error("pi-permissions: matchAgentRule is implemented in FS1");
}
