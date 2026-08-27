/**
 * Evaluator (FS1): canonicalize → safety (stub pass-through in FS1; FS3
 * wires the real always-on floor) → deny → ask → allow, first-match within
 * each action list (D7: deny anywhere beats allow anywhere; ask beats allow;
 * source order never affects the outcome — only which rule is reported).
 */

import type { CanonicalTarget, EvalResult, ParsedRule } from "./types.ts";
import { matchBashRule } from "./rules/bash.ts";
import { matchPathRule } from "./rules/paths.ts";
import { matchDomainRule } from "./rules/webfetch.ts";
import { matchMcpRule } from "./rules/mcp.ts";
import { matchAgentRule } from "./rules/agent.ts";

/** Safety hook. FS1 default: pass-through. FS3: always-on floor (catastrophic,
 *  critical rm -rf, protectedPaths incl. read gating). */
export type SafetyHook = (target: CanonicalTarget) => { blocked: boolean; reason?: string } | undefined;

export type EvaluateOptions = {
	checkSafety?: SafetyHook;
	/** PowerShell commands match case-insensitively (Claude parity). */
	caseInsensitiveBash?: boolean;
};

/** Evaluate a canonical target against the merged rule set. */
export function evaluate(
	rules: ParsedRule[],
	target: CanonicalTarget,
	opts: EvaluateOptions = {},
): EvalResult {
	if (opts.checkSafety) {
		const verdict = opts.checkSafety(target);
		if (verdict?.blocked) {
			return { action: "deny", source: "safety", safetyReason: verdict.reason ?? "blocked by safety floor" };
		}
	}

	for (const action of ["deny", "ask", "allow"] as const) {
		for (const rule of rules) {
			if (rule.action !== action) continue;
			if (ruleMatches(rule, target, opts)) {
				return { action, matchedRule: rule, source: rule.sources[0] };
			}
		}
	}
	return { action: "none" };
}

/** Dispatch one rule against a canonical target. */
export function ruleMatches(rule: ParsedRule, target: CanonicalTarget, opts?: EvaluateOptions): boolean {
	// Tool-name-position globs (deny/ask only by grammar).
	if (rule.toolGlob === "*") return true;
	if (rule.toolGlob === "mcp__*") return target.family === "mcp";

	switch (rule.family) {
		case "bash":
			if (target.family !== "bash" || !toolEq(rule.tool, target.tool)) return false;
			if (rule.glob === undefined) return true;
			return matchBashRule(rule.glob, target.command ?? "", {
				caseInsensitive: opts?.caseInsensitiveBash || rule.tool === "PowerShell",
			});

		case "path":
			if (target.family !== "path") return false;
			if (!pathToolMatrix(rule, target)) return false;
			if (rule.path === undefined) return true; // whole-tool
			return matchPathRule(rule.path, target.path ?? "");

		case "webfetch":
			if (target.family !== "webfetch" || !toolEq(rule.tool, target.tool)) return false;
			if (rule.domains === undefined) return true; // whole-tool
			return matchDomainRule(rule.domains, target.hostname);

		case "websearch":
			return target.family === "websearch" && toolEq(rule.tool, target.tool);

		case "agent":
			return matchAgentRule(rule.agentName, target);

		case "mcp":
			return matchMcpRule({ server: rule.mcpServer!, tool: rule.mcpTool }, target);

		case "other":
			// Whole-tool rules for pi tools without a Claude analog (Todo,
			// intercom, the unresolved gateway `mcp`, …).
			return target.family === "other" && toolEq(rule.tool, target.tool);
	}
	return false;
}

/**
 * Read/Edit/Write cross-tool matrix (Claude parity, researcher artifact §3):
 * - `Read(...)` rules match Read targets of any action; a Read DENY/ASK also
 *   blocks Edit/Write on that path (incl. file creation).
 * - `Edit(...)` rules govern Edit AND Write targets; an Edit ALLOW also
 *   grants read on that path.
 * - `Write` rules exist only as whole-tool (path forms are rejected at parse).
 */
function pathToolMatrix(rule: ParsedRule, target: CanonicalTarget): boolean {
	if (rule.tool === "Read") {
		if (target.tool === "Read") return true;
		return (rule.action === "deny" || rule.action === "ask") && (target.tool === "Edit" || target.tool === "Write");
	}
	if (rule.tool === "Edit") {
		if (target.tool === "Edit" || target.tool === "Write") return true;
		return rule.action === "allow" && target.tool === "Read";
	}
	if (rule.tool === "Write") {
		return target.tool === "Write";
	}
	return toolEq(rule.tool, target.tool);
}

/** Case-insensitive canonical tool-name equality. */
function toolEq(ruleTool: string, targetTool: string): boolean {
	return ruleTool.toLowerCase() === targetTool.toLowerCase();
}
