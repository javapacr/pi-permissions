/**
 * Single ask dialog (`Allow once / Allow for session / Always / Deny /
 * Deny for session`) with a rule-keyed session cache and headless
 * fail-closed behavior. TODO(FS3) — see docs/pi-permissions-backlog.md §FS3.
 */
export type AskDecision = "once" | "session" | "always" | "deny" | "deny-session";

export function ask(
  _spec: string,
  _input: Record<string, unknown>,
): AskDecision {
  throw new Error("pi-permissions: ask is implemented in FS3");
}
