/**
 * Dual-source rule loader (FS1, decisions D3/D6/D7).
 *
 * Six scopes, union + dedupe, per-source provenance retained:
 * - Claude: `<cwd>/.claude/settings.json`, `<cwd>/.claude/settings.local.json`,
 *   `~/.config/claude/settings.json`
 * - pi: `<agentDir>/permissions.json` (user; agentDir honors
 *   PI_CODING_AGENT_DIR — fixes FS0's hardcoded-path caveat),
 *   `<cwd>/.pi/permissions.json` (project), `<cwd>/.pi/permissions.local.json`
 *   (local).
 *
 * Evaluation is order-independent (deny anywhere beats allow anywhere; ask
 * beats allow — enforced by the evaluator); scope order below affects display
 * and first-match reporting only. Pi files may carry config keys
 * (defaultMode, protectedPaths, productionSupport, children, persistTarget) —
 * parsed and exposed, not acted on until FS2+.
 *
 * Also hosted the FS0 zackify-legacy config reader until FS2 deleted it
 * (the mode engine now loads through loadRules alone).
 *
 * All file paths injectable for tests; real defaults resolve at runtime.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { LoadedConfig, ParsedRule, PiConfigKeys, PiScope, RuleAction, RuleIssue } from "./types.ts";
import { parseRuleSpec } from "./rules/parse.ts";
import { getPiAgentDir } from "./canonicalize.ts";
import { stringOrUndefined } from "./modes.ts";

export type LoaderPaths = {
	claudeProject?: string;
	claudeLocal?: string;
	claudeGlobal?: string;
	piUser?: string;
	piProject?: string;
	piLocal?: string;
	home?: string;
	cwd?: string;
};

export function defaultLoaderPaths(cwd: string = process.cwd()): Required<LoaderPaths> {
	const home = homedir();
	const agentDir = getPiAgentDir();
	return {
		claudeProject: join(resolve(cwd), ".claude", "settings.json"),
		claudeLocal: join(resolve(cwd), ".claude", "settings.local.json"),
		claudeGlobal: join(home, ".config", "claude", "settings.json"),
		piUser: join(agentDir, "permissions.json"),
		piProject: join(resolve(cwd), ".pi", "permissions.json"),
		piLocal: join(resolve(cwd), ".pi", "permissions.local.json"),
		home,
		cwd: resolve(cwd),
	};
}

type ScopeSpec = {
	scope: PiScope;
	file: string;
	/** Anchor directory for `/path` rules in this scope. */
	anchorDir: string;
};

/** Load and merge all six scopes. Never throws for missing/broken files. */
export async function loadRules(paths?: LoaderPaths): Promise<LoadedConfig> {
	const p = { ...defaultLoaderPaths(paths?.cwd), ...paths } as Required<LoaderPaths>;

	const scopes: ScopeSpec[] = [
		{ scope: "claude-project", file: p.claudeProject, anchorDir: dirname(dirname(p.claudeProject)) },
		{ scope: "claude-local", file: p.claudeLocal, anchorDir: dirname(dirname(p.claudeLocal)) },
		{ scope: "claude-global", file: p.claudeGlobal, anchorDir: p.home },
		{ scope: "pi-user", file: p.piUser, anchorDir: p.home },
		{ scope: "pi-project", file: p.piProject, anchorDir: p.cwd },
		{ scope: "pi-local", file: p.piLocal, anchorDir: p.cwd },
	];

	const rules: ParsedRule[] = [];
	const issues: RuleIssue[] = [];
	const sources: Array<{ file: string; scope: PiScope }> = [];
	const keys: PiConfigKeys = {};

	for (const scopeSpec of scopes) {
		const parsed = await readScope(scopeSpec, { home: p.home, cwd: p.cwd });
		if (!parsed) continue;
		sources.push({ file: scopeSpec.file, scope: scopeSpec.scope });
		issues.push(...parsed.issues);

		for (const rule of parsed.rules) {
			const existing = rules.find((r) => r.action === rule.action && r.spec === rule.spec);
			if (existing) existing.sources.push(scopeSpec.file);
			else rules.push({ ...rule, sources: [scopeSpec.file] });
		}
		if (parsed.keys) mergeKeys(keys, parsed.keys);
	}

	return { rules, issues, sources, keys };
}

async function readScope(
	scopeSpec: ScopeSpec,
	ctx: { home: string; cwd: string },
): Promise<{ rules: ParsedRule[]; issues: RuleIssue[]; keys?: PiConfigKeys } | null> {
	let text: string;
	try {
		text = await readFile(scopeSpec.file, "utf-8");
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return null; // absent scope — the normal case
		// R6 (review): unreadable ≠ absent — surface it, never silently drop.
		return {
			rules: [],
			issues: [{ spec: "<scope>", action: "allow", file: scopeSpec.file, message: `unreadable (${code ?? "error"}) — rules from this file were NOT loaded` }],
		};
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		// R6 (review): unparsable JSON used to be indistinguishable from a
		// missing file — every rule in the scope (including denies) silently
		// vanished. Now it counts as an issue: ⚠N in the status slot + the
		// 🩺 Invalid-specs section, while the OTHER scopes still load.
		return {
			rules: [],
			issues: [{ spec: "<scope>", action: "allow", file: scopeSpec.file, message: `unparsable JSON (${err instanceof Error ? err.message : String(err)}) — rules from this file were NOT loaded` }],
		};
	}
	if (!raw || typeof raw !== "object") return null;
	const root = raw as Record<string, unknown>;
	const permsBlock = root.permissions && typeof root.permissions === "object"
		? (root.permissions as Record<string, unknown>)
		: root; // tolerate top-level arrays

	const rules: ParsedRule[] = [];
	const issues: RuleIssue[] = [];
	for (const action of ["allow", "deny", "ask"] as RuleAction[]) {
		const list = permsBlock[action];
		if (list === undefined) continue;
		if (!Array.isArray(list)) {
			issues.push({ spec: `<${action}>`, action, file: scopeSpec.file, message: `${action} is not an array` });
			continue;
		}
		for (const entry of list) {
			if (typeof entry !== "string") {
				issues.push({ spec: String(entry), action, file: scopeSpec.file, message: "rule entry is not a string" });
				continue;
			}
			const outcome = parseRuleSpec(entry, action, {
				home: ctx.home,
				anchorDir: scopeSpec.anchorDir,
				cwd: ctx.cwd,
			});
			if (outcome.ok) rules.push(outcome.rule);
			else issues.push({ ...outcome.issue, file: scopeSpec.file });
		}
	}

	const keys = scopeSpec.scope.startsWith("pi-") ? extractPiKeys(root) : undefined;
	return { rules, issues, keys };
}

/** Pi-file config keys (D6) — parsed, exposed, not acted on until FS2+. */
function extractPiKeys(root: Record<string, unknown>): PiConfigKeys {
	const keys: PiConfigKeys = {};
	const mode = stringOrUndefined(root.defaultMode);
	if (mode) keys.defaultMode = mode;
	if (Array.isArray(root.protectedPaths)) {
		const paths = root.protectedPaths.filter((p): p is string => typeof p === "string" && p.length > 0);
		if (paths.length > 0) keys.protectedPaths = paths;
	}
	if (root.productionSupport && typeof root.productionSupport === "object") {
		const ps = root.productionSupport as Record<string, unknown>;
		const readOnlyBash = Array.isArray(ps.readOnlyBash)
			? ps.readOnlyBash.filter((s): s is string => typeof s === "string")
			: undefined;
		keys.productionSupport = { ...ps, ...(readOnlyBash ? { readOnlyBash } : {}) };
	}
	if (root.children && typeof root.children === "object") {
		keys.children = root.children as Record<string, unknown>;
	}
	const persist = stringOrUndefined(root.persistTarget);
	if (persist) keys.persistTarget = persist;
	return Object.keys(keys).length > 0 ? keys : {};
}

/** Later scopes (user → project → local) win per key. */
function mergeKeys(target: PiConfigKeys, incoming: PiConfigKeys) {
	if (incoming.defaultMode !== undefined) target.defaultMode = incoming.defaultMode;
	if (incoming.protectedPaths !== undefined) target.protectedPaths = incoming.protectedPaths;
	if (incoming.productionSupport !== undefined) target.productionSupport = incoming.productionSupport;
	if (incoming.children !== undefined) target.children = incoming.children;
	if (incoming.persistTarget !== undefined) target.persistTarget = incoming.persistTarget;
}
