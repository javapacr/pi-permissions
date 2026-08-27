/**
 * Claude rule-string parser (FS1) — the grammar from the researcher artifact
 * (ccperms.md §3), hardened against the bridge's silent-skip defect:
 * every unknown/invalid spec produces a counted issue, never a silent drop.
 *
 * Supported:
 * - Bare tool names (`Bash`, `Read`, `Todo`, …) — any bare token is a valid
 *   whole-tool rule (pi has dynamic extension tools).
 * - `Bash(glob)` / `PowerShell(glob)` incl. trailing `:*` semantics; `Bash(*)` ≡ `Bash`.
 * - `Read/Edit(path)` gitignore-style (`//`, `~/`, `/`-anchored, bare = any
 *   depth, `**`). `Grep/Glob/Find/Ls` fold into Read (Claude parity).
 *   `Write(path)` is rejected — Claude never consults it; use `Edit(path)`.
 * - `WebFetch(domain:…)` and comma-separated domain lists.
 * - `mcp__server`, `mcp__server__tool`, `mcp__server__*` (no parentheses —
 *   those are skipped in Claude settings too).
 * - `Agent(name)`; bare `Agent` = any agent.
 * - Tool-name-position globs `*` and `mcp__*` — deny/ask only (allow-side
 *   unanchored globs are skipped with a warning, Claude parity).
 *
 * Rejected (warn + count): empty specs, `Write(path)`, `WebSearch(spec)`,
 * parenthesized `mcp__…(…)`, parameter forms (`Tool(param:value)`),
 * `Agent(*)`, other tool-name globs, specifiers on unknown tools.
 */

import type { ParsedRule, RuleAction, RuleIssue } from "../types.ts";
import { compilePathPattern } from "./paths.ts";
import { normalizeDomain } from "./webfetch.ts";

export type ParseContext = {
	home: string;
	/** Anchor directory for `/path` rules (the source scope's anchor). */
	anchorDir: string;
	cwd: string;
};

export type ParseOutcome = { ok: true; rule: ParsedRule } | { ok: false; issue: RuleIssue };

const BASH_TOOLS = new Set(["bash", "powershell"]);
const READ_TOOLS = new Set(["read", "grep", "glob", "find", "ls"]);
const PATH_FREE_TOOLS = new Set(["write"]);
const WEBFETCH_TOOLS = new Set(["webfetch"]);

/** Parse one rule spec. Never throws — invalid specs come back as issues. */
export function parseRuleSpec(spec: string, action: RuleAction, ctx: ParseContext): ParseOutcome {
	const trimmed = spec.trim();
	const fail = (message: string): ParseOutcome => ({ ok: false, issue: { spec, action, message } });
	if (trimmed === "") return fail("empty rule spec");

	// MCP rules — mcp__server, mcp__server__tool, mcp__server__*.
	// (Bare `mcp` and the server-position glob `mcp__*` fall through to the
	// whole-tool rules below.)
	if (trimmed.startsWith("mcp__") && trimmed !== "mcp__*") {
		if (trimmed.includes("(")) {
			return fail("mcp__ rules with parentheses are skipped (Claude parity); globs are legal only after a literal mcp__<server>__ prefix");
		}
		const parts = trimmed.split("__");
		const server = parts[1] ?? "";
		if (server === "") return fail("mcp__ rule is missing a server name");
		const toolPart = parts.slice(2).join("__");
		if (toolPart === "" && parts.length > 2) return fail("mcp__ rule is missing a tool name after the server");
		const rule: ParsedRule = {
			action,
			spec,
			family: "mcp",
			tool: toolPart === "" ? `mcp__${server}` : `mcp__${server}__${toolPart}`,
			mcpServer: server,
			mcpTool: toolPart === "" ? undefined : toolPart === "*" ? "*" : toolPart,
			sources: [],
		};
		if (toolPart.includes("*") && toolPart !== "*") {
			return fail("wildcards in mcp rules are legal only as the trailing `mcp__server__*` form");
		}
		return { ok: true, rule };
	}

	// Tool(specifier) forms.
	const call = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)\(([\s\S]*)\)$/);
	if (call) {
		const token = call[1]!.toLowerCase();
		const inner = call[2]!.trim();
		if (inner === "") return fail(`${call[1]}() has an empty specifier`);

		if (BASH_TOOLS.has(token)) {
			if (inner === "*") {
				return wholeTool(spec, action, token === "powershell" ? "PowerShell" : "Bash", "bash");
			}
			return {
				ok: true,
				rule: {
					action, spec, family: "bash",
					tool: token === "powershell" ? "PowerShell" : "Bash",
					glob: inner, sources: [],
				},
			};
		}

		if (token === "read" || READ_TOOLS.has(token)) {
			return {
				ok: true,
				rule: {
					action, spec, family: "path", tool: "Read",
					path: compilePathPattern(inner, action, ctx), sources: [],
				},
			};
		}
		if (token === "edit") {
			return {
				ok: true,
				rule: {
					action, spec, family: "path", tool: "Edit",
					path: compilePathPattern(inner, action, ctx), sources: [],
				},
			};
		}
		if (token === "write") {
			return fail("Write(path) rules are never consulted (Claude parity) — use Edit(path) to govern writes");
		}

		if (WEBFETCH_TOOLS.has(token)) {
			let list = inner;
			if (list.toLowerCase().startsWith("domain:")) list = list.slice(7);
			const domains = list.split(",").map((d) => normalizeDomain(d)).filter((d) => d !== "");
			if (domains.length === 0) return fail("WebFetch specifier has no domains");
			return {
				ok: true,
				rule: { action, spec, family: "webfetch", tool: "WebFetch", domains, sources: [] },
			};
		}

		if (token === "websearch") {
			return fail("WebSearch takes no specifier — bare `WebSearch` only");
		}

		if (token === "agent") {
			if (inner.includes(":")) return fail("parameter matching (Agent(param:value)) is not supported yet (parking lot)");
			if (inner === "*") return fail("Agent wildcard is not supported — use bare `Agent`");
			return {
				ok: true,
				rule: { action, spec, family: "agent", tool: "Agent", agentName: inner, sources: [] },
			};
		}

		return fail(`unknown tool \`${call[1]}\` — specifier forms are supported only for Bash, Read, Edit, WebFetch, Agent and mcp__ rules`);
	}

	// Bare forms.
	if (trimmed.includes("(") || trimmed.includes(")")) {
		return fail("malformed rule — unmatched parenthesis");
	}
	if (trimmed === "*") {
		if (action === "allow") return fail("allow-side unanchored glob `*` is skipped (Claude parity)");
		return { ok: true, rule: { action, spec, family: "other", tool: "*", toolGlob: "*", sources: [] } };
	}
	if (trimmed === "mcp__*") {
		if (action === "allow") return fail("allow-side unanchored glob `mcp__*` is skipped (Claude parity)");
		return { ok: true, rule: { action, spec, family: "other", tool: "mcp__*", toolGlob: "mcp__*", sources: [] } };
	}
	if (/[*?]/.test(trimmed)) {
		return fail("tool-name-position globs beyond `*` and `mcp__*` are not supported");
	}

	const token = trimmed.toLowerCase();
	if (BASH_TOOLS.has(token)) return wholeTool(spec, action, token === "powershell" ? "PowerShell" : "Bash", "bash");
	if (token === "read" || READ_TOOLS.has(token)) return wholeTool(spec, action, "Read", "path");
	if (token === "edit") return wholeTool(spec, action, "Edit", "path");
	if (PATH_FREE_TOOLS.has(token)) return wholeTool(spec, action, "Write", "path");
	if (WEBFETCH_TOOLS.has(token)) return wholeTool(spec, action, "WebFetch", "webfetch");
	if (token === "websearch") return wholeTool(spec, action, "WebSearch", "websearch");
	if (token === "agent") return wholeTool(spec, action, "Agent", "agent");

	// Free-form whole-tool rule (pi extension tools: Todo, intercom, …).
	return wholeTool(spec, action, trimmed, "other");
}

function wholeTool(spec: string, action: RuleAction, tool: string, family: ParsedRule["family"]): ParseOutcome {
	return { ok: true, rule: { action, spec, family, tool, sources: [] } };
}
