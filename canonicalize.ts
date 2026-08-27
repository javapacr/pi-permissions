/**
 * Canonicalizer: maps a pi tool call (toolName + input) to its Claude-style
 * rule target (pi builtins, gateway `mcp`, direct MCP tools, `subagent`).
 * TODO(FS1) — filled by the rule-engine core; see
 * docs/pi-permissions-backlog.md §FS1.
 */
export type CanonicalTarget = {
  /** Claude-style rule spec the call maps to, e.g. "Bash", "Edit", "mcp__mempalace__search". */
  spec: string;
  /** Canonical family for rule dispatch. */
  family: "bash" | "path" | "webfetch" | "websearch" | "mcp" | "agent" | "other";
};

export function canonicalize(
  _toolName: string,
  _input: Record<string, unknown>,
): CanonicalTarget {
  throw new Error("pi-permissions: canonicalize is implemented in FS1");
}
