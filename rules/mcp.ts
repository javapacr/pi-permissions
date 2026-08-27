/**
 * MCP rule matching: `mcp__server`, `mcp__server__tool`, `mcp__server__*`
 * against both direct tools and gateway `mcp` calls (canonicalized first).
 * TODO(FS1) — filled by the rule-engine core; see
 * docs/pi-permissions-backlog.md §FS1.
 */
export function matchMcpRule(_pattern: string, _server: string, _tool?: string): boolean {
  throw new Error("pi-permissions: matchMcpRule is implemented in FS1");
}
