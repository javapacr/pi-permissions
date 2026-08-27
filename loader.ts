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
 * Also hosts the FS0 zackify-legacy config reader (`loadZackifyCompatConfig`),
 * moved verbatim out of index.ts so this module is the single config surface.
 * FS2 rewires the mode engine onto `loadRules()` and deletes the legacy path.
 *
 * All file paths injectable for tests; real defaults resolve at runtime.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { LoadedConfig, ParsedRule, PiConfigKeys, PiScope, RuleAction, RuleIssue } from "./types.ts";
import { parseRuleSpec } from "./rules/parse.ts";
import { getPiAgentDir } from "./canonicalize.ts";
import { stringArrayOrUndefined, stringOrUndefined } from "./modes.ts";
import type { ModeDefinition, Pattern } from "./modes.ts";

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
	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(scopeSpec.file, "utf-8"));
	} catch {
		return null; // missing or unparsable — absent scope
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

// ---------------------------------------------------------------------------
// FS0 zackify-legacy config reader — moved verbatim from index.ts (same
// paths, same precedence, same defaults) so loader.ts is the single config
// surface. FS2 rewires the mode engine onto loadRules() and deletes this.
// ---------------------------------------------------------------------------

export interface PermissionsConfig {
	mode?: string;
	dangerousPatterns?: Pattern[];
	catastrophicPatterns?: Pattern[];
	protectedPaths?: string[];
	allowCatastrophic?: boolean;
	shiftTabOptions?: string[];
	defaultMode?: string;
	hideDefaultMode?: boolean;
	planModeAllowedMcpServers?: string[];
	customModes?: ModeDefinition[];
}

export interface PiSettingsConfig {
	piClaudePermissions?: {
		allowCatastrophic?: boolean;
		shiftTabOptions?: string[];
		defaultMode?: string;
		hideDefaultMode?: boolean;
		planModeAllowedMcpServers?: string[];
		customModes?: ModeDefinition[];
	};
}

export const DEFAULT_DANGEROUS: Pattern[] = [
	{ pattern: "chmod -R 777", description: "insecure recursive permissions" },
	{ pattern: "chown -R", description: "recursive ownership change" },
	{ pattern: "> /dev/", description: "direct device write" },
];

export const DEFAULT_CATASTROPHIC: Pattern[] = [
	{ pattern: "sudo mkfs", description: "sudo filesystem format" },
	{ pattern: "mkfs.", description: "filesystem format" },
	{ pattern: "dd if=", description: "raw disk write" },
	{ pattern: ":(){ :|:& };:", description: "fork bomb" },
	{ pattern: "> /dev/sda", description: "overwrite disk" },
	{ pattern: "> /dev/nvme", description: "overwrite disk" },
	{ pattern: "sudo dd", description: "sudo raw disk operation" },
];

export const DEFAULT_PROTECTED_PATHS = [
	"~/.ssh", "~/.aws", "~/.gnupg", "~/.gpg", "~/.bashrc", "~/.bash_profile",
	"~/.profile", "~/.zshrc", "~/.zprofile", "~/.config/git/credentials",
	"~/.netrc", "~/.npmrc", "~/.docker/config.json", "~/.kube/config", "~/.pi/agent/auth.json",
];

export type ZackifyCompatPaths = {
	globalPermissions?: string;
	localPermissions?: string;
	globalSettings?: string;
	localSettings?: string;
	home?: string;
	cwd?: string;
};

/** FS0's `loadConfig()`, verbatim, with injectable paths. */
export async function loadZackifyCompatConfig(paths?: ZackifyCompatPaths): Promise<PermissionsConfig> {
	const home = paths?.home ?? homedir();
	const cwd = resolve(paths?.cwd ?? process.cwd());
	const globalPath = paths?.globalPermissions ?? resolve(home, ".pi/agent/extensions/permissions.json");
	const localPath = paths?.localPermissions ?? resolve(cwd, ".pi/extensions/permissions.json");
	const globalSettingsPath = paths?.globalSettings ?? resolve(home, ".pi/agent/settings.json");
	const localSettingsPath = paths?.localSettings ?? resolve(cwd, ".pi/settings.json");
	const global = await readJson<PermissionsConfig>(globalPath);
	const local = await readJson<PermissionsConfig>(localPath);
	const globalSettings = await readJson<PiSettingsConfig>(globalSettingsPath);
	const localSettings = await readJson<PiSettingsConfig>(localSettingsPath);

	return {
		mode: stringOrUndefined(local.mode ?? global.mode),
		dangerousPatterns: local.dangerousPatterns ?? global.dangerousPatterns ?? DEFAULT_DANGEROUS,
		catastrophicPatterns: local.catastrophicPatterns ?? global.catastrophicPatterns ?? DEFAULT_CATASTROPHIC,
		protectedPaths: local.protectedPaths ?? global.protectedPaths ?? DEFAULT_PROTECTED_PATHS,
		allowCatastrophic: localSettings.piClaudePermissions?.allowCatastrophic
			?? globalSettings.piClaudePermissions?.allowCatastrophic
			?? false,
		shiftTabOptions: localSettings.piClaudePermissions?.shiftTabOptions
			?? globalSettings.piClaudePermissions?.shiftTabOptions
			?? local.shiftTabOptions
			?? global.shiftTabOptions,
		defaultMode: stringOrUndefined(localSettings.piClaudePermissions?.defaultMode
			?? globalSettings.piClaudePermissions?.defaultMode
			?? local.defaultMode
			?? global.defaultMode),
		hideDefaultMode: localSettings.piClaudePermissions?.hideDefaultMode
			?? globalSettings.piClaudePermissions?.hideDefaultMode
			?? local.hideDefaultMode
			?? global.hideDefaultMode,
		planModeAllowedMcpServers: stringArrayOrUndefined(localSettings.piClaudePermissions?.planModeAllowedMcpServers)
			?? stringArrayOrUndefined(globalSettings.piClaudePermissions?.planModeAllowedMcpServers)
			?? stringArrayOrUndefined(local.planModeAllowedMcpServers)
			?? stringArrayOrUndefined(global.planModeAllowedMcpServers),
		customModes: localSettings.piClaudePermissions?.customModes
			?? globalSettings.piClaudePermissions?.customModes
			?? local.customModes
			?? global.customModes,
	};
}

async function readJson<T>(path: string): Promise<T | Record<string, never>> {
	try {
		return JSON.parse(await readFile(path, "utf-8"));
	} catch {
		return {};
	}
}
