/**
 * REFERENCE ONLY — grafted from javapacr/pi-claude-permissions-bridge (MIT).
 * Not compiled, not imported by the extension. Reworked/superseded in FS1
 * per docs/pi-permissions-backlog.md. Keep verbatim for provenance.
 */
export type RuleAction = "allow" | "deny" | "ask";

export interface PiRule {
	toolName: string;
	matchType: "command" | "url-domain" | "exact-tool" | "tool-name";
	pattern: RegExp | null; // null = match entire tool
	action: RuleAction;
	original: string;
}

function globToRegex(glob: string): RegExp {
	// Escape regex metacharacters except `*`; we want `*` to become `.*`.
	const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	// Replace literal `*` with `.*` to implement glob matching.
	const regexStr = escaped.replace(/\*/g, ".*");
	// Only anchor end if glob didn't end with *
	const anchored = glob.endsWith("*") ? `^${regexStr}` : `^${regexStr}$`;
	return new RegExp(anchored);
}

export function convertRule(spec: string, action: RuleAction): PiRule | null {
	// Bash(pattern)
	const bashMatch = spec.match(/^Bash\((.+)\)$/);
	if (bashMatch) {
		return {
			toolName: "bash",
			matchType: "command",
			pattern: globToRegex(bashMatch[1]),
			action,
			original: spec,
		};
	}

	// WebFetch(domain:x)
	const webFetchMatch = spec.match(/^WebFetch\(domain:(.+)\)$/);
	if (webFetchMatch) {
		const domain = webFetchMatch[1];
		const domainRegex = globToRegex(domain);
		return {
			toolName: "web_fetch",
			matchType: "url-domain",
			pattern: domainRegex,
			action,
			original: spec,
		};
	}

	// WebFetch (no domain filter)
	if (spec === "WebFetch") {
		return {
			toolName: "web_fetch",
			matchType: "exact-tool",
			pattern: null,
			action,
			original: spec,
		};
	}

	// WebSearch
	if (spec === "WebSearch") {
		return {
			toolName: "web_search",
			matchType: "exact-tool",
			pattern: null,
			action,
			original: spec,
		};
	}

	// Read / Write / Edit
	if (spec === "Read")
		return {
			toolName: "read",
			matchType: "exact-tool",
			pattern: null,
			action,
			original: spec,
		};
	if (spec === "Write")
		return {
			toolName: "write",
			matchType: "exact-tool",
			pattern: null,
			action,
			original: spec,
		};
	if (spec === "Edit")
		return {
			toolName: "edit",
			matchType: "exact-tool",
			pattern: null,
			action,
			original: spec,
		};

	// MCP tools: mcp__x__y__z
	if (spec.startsWith("mcp__")) {
		return {
			toolName: spec,
			matchType: "tool-name",
			pattern: null,
			action,
			original: spec,
		};
	}

	// Unknown
	return null;
}

export function convertAllRules(permissions: {
	allow: string[];
	deny: string[];
	ask: string[];
}): PiRule[] {
	const rules: PiRule[] = [];
	for (const spec of permissions.deny) {
		const r = convertRule(spec, "deny");
		if (r) rules.push(r);
	}
	for (const spec of permissions.ask) {
		const r = convertRule(spec, "ask");
		if (r) rules.push(r);
	}
	for (const spec of permissions.allow) {
		const r = convertRule(spec, "allow");
		if (r) rules.push(r);
	}
	return rules;
}
