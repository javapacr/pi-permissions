/**
 * MCP rule matching (FS1) — Claude semantics per the researcher artifact
 * (ccperms.md §3, "MCP" row):
 *
 * - `mcp__server` matches the whole server (any of its tools, and the
 *   server-level canonical form itself).
 * - `mcp__server__*` is the wildcard equivalent of `mcp__server`.
 * - `mcp__server__tool` matches exactly that tool.
 * - Literal-prefix rule, case-sensitive (server names are configured names).
 * - Any `mcp__…(…)` rule with parentheses is rejected by the parser
 *   (Claude skips those at settings load); globs are legal only after a
 *   literal `mcp__<server>__` prefix.
 */

import type { CanonicalTarget } from "../types.ts";

/** Canonical server/tool rule shape produced by the parser. */
export type McpRuleParts = {
	server: string;
	tool?: string | "*";
};

export function matchMcpRule(rule: McpRuleParts, target: CanonicalTarget): boolean {
	if (target.family !== "mcp") return false;
	const canonicalServer = `mcp__${rule.server}`;
	const prefix = `${canonicalServer}__`;

	if (rule.tool === undefined || rule.tool === "*") {
		// Whole server: the server-level canonical form or any of its tools.
		return target.tool === canonicalServer || target.tool.startsWith(prefix);
	}
	return target.tool === `${prefix}${rule.tool}`;
}
