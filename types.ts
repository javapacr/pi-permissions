/**
 * pi-permissions — shared types for the rule engine (FS1).
 *
 * One place for the shapes exchanged by parser (rules/parse.ts),
 * canonicalizer (canonicalize.ts), loader (loader.ts) and evaluator
 * (evaluator.ts). Grammar ground truth: docs/permissions-deep-research.md
 * §3 + the cited researcher artifact (ccperms.md).
 */

/** Rule action from Claude settings `permissions.{allow,deny,ask}`. */
export type RuleAction = "allow" | "deny" | "ask";

/** Evaluation families the engine dispatches on. */
export type RuleFamily =
	| "bash"
	| "path"
	| "webfetch"
	| "websearch"
	| "mcp"
	| "agent"
	| "other";

/** A parsed, compiled rule string (one entry of allow/deny/ask). */
export type ParsedRule = {
	action: RuleAction;
	/** Original spec string exactly as written in config. */
	spec: string;
	family: RuleFamily;
	/**
	 * Canonical Claude tool name used for whole-tool dispatch:
	 * "Bash" | "Read" | "Edit" | "WebFetch" | "WebSearch" | "Agent" |
	 * "mcp__server" | "mcp__server__tool" | free-form bare name.
	 */
	tool: string;
	/** Bash/PowerShell glob pattern (family "bash"). */
	glob?: string;
	/** Compiled path pattern (family "path"). */
	path?: CompiledPath;
	/** Domain list (family "webfetch"); entries already normalized. */
	domains?: string[];
	/** MCP server (family "mcp"); tool is "*", undefined, or a literal name. */
	mcpServer?: string;
	mcpTool?: string | "*";
	/** Agent name (family "agent"); undefined = any agent. */
	agentName?: string;
	/** Tool-name-position glob (deny/ask only): "*" = every tool, "mcp__*" = every MCP tool. */
	toolGlob?: "*" | "mcp__*";
	/**
	 * Provenance: files this rule was loaded from (first = primary source).
	 * Display/persist only — never affects evaluation (D7).
	 */
	sources: string[];
};

/** Invalid/unsupported spec — warned + counted, never silently skipped. */
export type RuleIssue = {
	spec: string;
	action: RuleAction;
	/** Config file the spec came from (if known at parse time). */
	file?: string;
	message: string;
};

/** Compiled gitignore-style path pattern (family "path"). */
export type CompiledPath = {
	/** Pattern segments; for absolute anchors these are full path segments from "/". */
	segments: string[];
	/** Precompiled per-segment matchers ("**" stays a marker). */
	matchers: Array<RegExp | "**">;
	/** Match at any segment alignment (bare names, `**`/-leading, deny/ask depth boost). */
	anyDepth: boolean;
	/** `P/**` also matches the named root `P` itself. */
	matchRoot: boolean;
};

/** The Claude-canonical target a live pi tool call maps to. */
export type CanonicalTarget = {
	/** Display form, e.g. `Bash(npm run build)` or `mcp__mempalace__search`. */
	spec: string;
	family: RuleFamily;
	/** Canonical tool name (see ParsedRule.tool). */
	tool: string;
	/** The pi wire tool name the call arrived as (e.g. "bash", "mempalace_mempalace_search"). */
	piTool: string;
	/** family "bash": the full command text. */
	command?: string;
	/** family "path": absolute resolved path. */
	path?: string;
	/** family "webfetch": lowercased hostname, trailing "." stripped. */
	hostname?: string;
	/** family "agent": the agent name from input.agent. */
	agent?: string;
};

/** Evaluator verdict. */
export type EvalResult = {
	action: RuleAction | "none";
	/** The rule that produced the decision (undefined for "none"). */
	matchedRule?: ParsedRule;
	/** Primary source file of matchedRule, or "safety" for a safety floor block. */
	source?: string;
	/** Set when the safety hook blocked (FS3 wires the real floor; FS1 = pass-through). */
	safetyReason?: string;
};

/** Config-scope identifiers (D3/D6: three Claude + three pi scopes). */
export type PiScope =
	| "claude-global"
	| "claude-project"
	| "claude-local"
	| "pi-user"
	| "pi-project"
	| "pi-local";

/** pi-file config keys parsed but not acted on until FS2+ (D6). */
export type PiConfigKeys = {
	defaultMode?: string;
	protectedPaths?: string[];
	productionSupport?: { readOnlyBash?: string[] } & Record<string, unknown>;
	children?: Record<string, unknown>;
	persistTarget?: string;
};

/** Result of the dual-source loader. */
export type LoadedConfig = {
	/** Union of all scopes, deduped; order = load order (display/first-match only). */
	rules: ParsedRule[];
	/** Invalid/unsupported specs, warn + count (bridge defect fix). */
	issues: RuleIssue[];
	/** Files actually read. */
	sources: Array<{ file: string; scope: PiScope }>;
	/** Merged pi config keys (local > project > user). */
	keys: PiConfigKeys;
};

/**
 * MCP registry: maps pi wire tool names to Claude-canonical `mcp__server__tool`
 * names, built from mcp.json configs + the adapter metadata cache.
 * Inputs are injectable; real paths are read only at runtime.
 */
export type McpRegistry = {
	/** Wire (direct-tool) name -> canonical name. */
	wireToCanonical: Map<string, string>;
	/** Configured server name -> raw tool names known for it. */
	rawTools: Map<string, string[]>;
	/** Configured server names. */
	servers: string[];
	/** Sanitized server prefixes (mode "server") for longest-prefix fallback. */
	prefixes: Array<{ server: string; prefix: string }>;
};
