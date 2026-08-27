/**
 * Canonicalizer (FS1): maps a pi tool call (toolName + input) to its
 * Claude-style rule target.
 *
 * pi builtins -> Claude names: bash→Bash, powershell→PowerShell,
 * read/grep/find/ls→Read (Claude folds Grep/Glob/LSP reads into Read),
 * edit→Edit, write→Write, web_fetch→WebFetch, web_search→WebSearch,
 * subagent→Agent. Tools with no Claude analog stay as-is (whole-tool rules).
 *
 * MCP — two surfaces, one canonical name (`mcp__server__tool`):
 * - Direct tools: wire names are `<sanitized-server>_<tool>` (adapter
 *   `formatToolName`, prefix mode "server" — the default) or
 *   `mcp__<sanitized-server>_<tool>` (mode "mcp"). Inverted via a registry
 *   built from mcp.json configs + the adapter metadata cache
 *   (`mcp-cache.json`), with unique-raw-name and longest-prefix fallbacks
 *   mirroring the adapter's own `resolveServerFromToolName`.
 * - Gateway `mcp` tool: `input.tool`/`server`/`connect`/`describe`/
 *   `instructions`/`search`/`action` shapes, dispatched in the adapter's own
 *   order, resolve to `mcp__server[__tool]`. Calls that resolve to no server
 *   canonicalize to the whole gateway tool (`mcp`).
 *
 * Registry inputs are injectable; real paths are read only by
 * `buildDefaultMcpRegistry()` at runtime.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { CanonicalTarget, McpRegistry } from "./types.ts";

/** pi wire tool name -> Claude-canonical tool name. */
export const PI_TO_CLAUDE: Record<string, string> = {
	bash: "Bash",
	powershell: "PowerShell",
	read: "Read",
	grep: "Read",
	find: "Read",
	ls: "Read",
	edit: "Edit",
	write: "Write",
	web_fetch: "WebFetch",
	web_search: "WebSearch",
	subagent: "Agent",
};

/**
 * pi tools we know are NOT MCP even though a registry entry could collide
 * (the adapter drops colliding direct tools, so a live call under these
 * names is always pi's own). Extension tools beyond this list rely on the
 * same adapter guard — documented limitation for exotic name collisions.
 */
const KNOWN_PI_TOOLS = new Set([
	...Object.keys(PI_TO_CLAUDE),
	"mcp",
	"mcpScript",
	"todo",
	"ask_user_question",
]);

/** Adapter `sanitizeServerPrefix` (verbatim semantics): keep [A-Za-z0-9_-]. */
export function sanitizeServerPrefix(serverName: string): string {
	return Array.from(serverName, (ch) =>
		/[A-Za-z0-9_-]/.test(ch) ? ch : `_${ch.codePointAt(0)!.toString(16)}_`,
	).join("");
}

export type RegistryInputs = {
	/** Parsed mcp.json config objects (`{ mcpServers: { … } }`). */
	configs?: unknown[];
	/** Parsed adapter cache objects (`{ servers: { server: { tools: […] } } }`). */
	caches?: unknown[];
};

/** Build the MCP registry from injectable inputs. Never throws on bad input. */
export function buildMcpRegistry(inputs: RegistryInputs = {}): McpRegistry {
	const wireToCanonical = new Map<string, string>();
	const rawTools = new Map<string, string[]>();
	const servers: string[] = [];
	const prefixes: Array<{ server: string; prefix: string }> = [];
	const prefixModes = new Map<string, string>();
	const rawClaims = new Map<string, string | "ambiguous">();

	const registerServer = (server: string) => {
		if (!servers.includes(server)) {
			servers.push(server);
			prefixes.push({ server, prefix: sanitizeServerPrefix(server) });
		}
	};
	const addRaw = (server: string, raw: string) => {
		registerServer(server);
		const list = rawTools.get(server) ?? [];
		if (!list.includes(raw)) list.push(raw);
		rawTools.set(server, list);
	};

	for (const cfg of inputs.configs ?? []) {
		if (!cfg || typeof cfg !== "object") continue;
		const root = cfg as Record<string, unknown>;
		const mcpServers = root.mcpServers;
		if (!mcpServers || typeof mcpServers !== "object") continue;
		const globalPrefix = (root.settings as Record<string, unknown> | undefined)?.toolPrefix;
		for (const [server, entryRaw] of Object.entries(mcpServers as Record<string, unknown>)) {
			if (!server) continue;
			registerServer(server);
			const entry = entryRaw && typeof entryRaw === "object" ? (entryRaw as Record<string, unknown>) : {};
			const mode = typeof entry.toolPrefix === "string"
				? entry.toolPrefix
				: typeof globalPrefix === "string" ? globalPrefix : "server";
			prefixModes.set(server, mode);
			if (Array.isArray(entry.directTools)) {
				for (const tool of entry.directTools) {
					if (typeof tool === "string" && tool) addRaw(server, tool);
				}
			}
		}
	}

	for (const cache of inputs.caches ?? []) {
		if (!cache || typeof cache !== "object") continue;
		const serversBlock = (cache as Record<string, unknown>).servers;
		if (!serversBlock || typeof serversBlock !== "object") continue;
		for (const [server, entryRaw] of Object.entries(serversBlock as Record<string, unknown>)) {
			if (!server) continue;
			registerServer(server);
			const entry = entryRaw && typeof entryRaw === "object" ? (entryRaw as Record<string, unknown>) : {};
			const tools = entry.tools;
			if (!Array.isArray(tools)) continue;
			for (const tool of tools) {
				const name = tool && typeof tool === "object" ? (tool as Record<string, unknown>).name : undefined;
				if (typeof name === "string" && name) addRaw(server, name);
			}
		}
	}

	for (const server of servers) {
		const san = sanitizeServerPrefix(server);
		const mode = prefixModes.get(server) ?? "server";
		for (const raw of rawTools.get(server) ?? []) {
			const wire = raw.replace(/\./g, "_");
			const canonical = `mcp__${server}__${raw}`;
			if (mode === "mcp") {
				setIfAbsent(wireToCanonical, `mcp__${san}_${wire}`, canonical);
			} else if (mode === "none") {
				// Raw name only; uniqueness resolved below via rawClaims.
			} else {
				// "server" (default). "short" approximated by the server-mode wire.
				setIfAbsent(wireToCanonical, `${san}_${wire}`, canonical);
			}
			const prev = rawClaims.get(wire);
			if (prev === undefined) rawClaims.set(wire, canonical);
			else if (prev !== canonical) rawClaims.set(wire, "ambiguous");
		}
	}
	// Unique raw names: usable directly (prefix mode "none" + gateway short forms).
	for (const [raw, canonical] of rawClaims) {
		if (canonical !== "ambiguous") setIfAbsent(wireToCanonical, raw, canonical);
	}

	return { wireToCanonical, rawTools, servers, prefixes };
}

function setIfAbsent(map: Map<string, string>, key: string, value: string) {
	if (!map.has(key)) map.set(key, value);
}

/** pi's agent dir (mirrors the adapter's `getAgentDir`): honors PI_CODING_AGENT_DIR. */
export function getPiAgentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	if (!configured) return join(homedir(), ".pi", "agent");
	if (configured === "~") return homedir();
	if (configured.startsWith("~/")) return resolve(homedir(), configured.slice(2));
	return resolve(configured);
}

/** Runtime registry from real paths (probe/live only — tests inject inputs). */
export function buildDefaultMcpRegistry(cwd: string = process.cwd()): McpRegistry {
	const agentDir = getPiAgentDir();
	const readJson = (path: string): unknown => {
		try {
			if (!existsSync(path)) return undefined;
			return JSON.parse(readFileSync(path, "utf-8"));
		} catch {
			return undefined;
		}
	};
	return buildMcpRegistry({
		configs: [
			readJson(join(agentDir, "mcp.json")),
			readJson(join(resolve(cwd), ".pi", "mcp.json")),
		].filter((c) => c !== undefined),
		caches: [readJson(join(agentDir, "mcp-cache.json"))].filter((c) => c !== undefined),
	});
}

export type CanonicalizeOptions = {
	cwd?: string;
	home?: string;
	registry?: McpRegistry;
};

/** Map a pi tool call to its Claude-canonical rule target. Never throws. */
export function canonicalize(
	toolName: string,
	input: Record<string, unknown>,
	opts: CanonicalizeOptions = {},
): CanonicalTarget {
	const cwd = resolve(opts.cwd ?? process.cwd());
	const home = opts.home ?? homedir();
	const registry = opts.registry;
	const str = (v: unknown): string | undefined =>
		typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

	const claude = PI_TO_CLAUDE[toolName];
	if (claude === "Bash" || claude === "PowerShell") {
		const command = str(input.command) ?? "";
		return { spec: `${claude}(${command})`, family: "bash", tool: claude, piTool: toolName, command };
	}
	if (claude === "Read") {
		const path = resolveToolPath(input.path, cwd, home);
		return { spec: `Read(${path})`, family: "path", tool: "Read", piTool: toolName, path };
	}
	if (claude === "Edit" || claude === "Write") {
		const path = resolveToolPath(input.path, cwd, home);
		return { spec: `${claude}(${path})`, family: "path", tool: claude, piTool: toolName, path };
	}
	if (claude === "WebFetch") {
		let hostname: string | undefined;
		const url = str(input.url);
		if (url) {
			try {
				hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
			} catch {
				hostname = undefined;
			}
		}
		return { spec: hostname ? `WebFetch(domain:${hostname})` : "WebFetch", family: "webfetch", tool: "WebFetch", piTool: toolName, hostname };
	}
	if (claude === "WebSearch") {
		return { spec: "WebSearch", family: "websearch", tool: "WebSearch", piTool: toolName };
	}
	if (claude === "Agent") {
		const agent = str(input.agent);
		return { spec: agent ? `Agent(${agent})` : "Agent", family: "agent", tool: "Agent", piTool: toolName, agent };
	}
	if (toolName === "mcp") {
		return canonicalizeGateway(input, registry);
	}
	if (!KNOWN_PI_TOOLS.has(toolName) && registry) {
		const direct = registry.wireToCanonical.get(toolName);
		if (direct) return { spec: direct, family: "mcp", tool: direct, piTool: toolName };
		if (toolName.startsWith("mcp__")) {
			// Already-canonical-shaped name (adapter prefix mode "mcp" without a
			// registry entry): pass through unchanged.
			return { spec: toolName, family: "mcp", tool: toolName, piTool: toolName };
		}
		const split = splitByLongestPrefix(toolName, registry);
		if (split) return { spec: split, family: "mcp", tool: split, piTool: toolName };
	}
	// Whole-tool fallback: pi builtins without a Claude analog, extension
	// tools, and unknown MCP direct names that resolve to no server.
	return { spec: toolName, family: "other", tool: toolName, piTool: toolName };
}

/** Resolve a tool path input to an absolute path (`~` expanded, cwd-anchored). */
function resolveToolPath(rawPath: unknown, cwd: string, home: string): string {
	const p = typeof rawPath === "string" && rawPath.trim() !== "" ? rawPath.trim() : ".";
	if (p === "~") return home;
	if (p.startsWith("~/")) return resolve(home, p.slice(2));
	return resolve(cwd, p);
}

/** Gateway `mcp` tool dispatch — mirrors the adapter's own action order. */
function canonicalizeGateway(input: Record<string, unknown>, registry?: McpRegistry): CanonicalTarget {
	const str = (v: unknown): string | undefined =>
		typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
	const server = str(input.server);
	const action = str(input.action);
	const tool = str(input.tool);
	const connect = str(input.connect);
	const describe = str(input.describe);
	const instructions = str(input.instructions);
	const search = str(input.search);

	const asServer = (name: string): CanonicalTarget => ({
		spec: `mcp__${name}`, family: "mcp", tool: `mcp__${name}`, piTool: "mcp",
	});
	const unresolved = (): CanonicalTarget => ({
		spec: "mcp", family: "other", tool: "mcp", piTool: "mcp",
	});

	// action: auth-start / auth-complete / ui-messages (server-scoped when present)
	if (action !== undefined) return server ? asServer(server) : unresolved();

	if (tool !== undefined) {
		const canonical = resolveGatewayToolName(tool, server, registry);
		return canonical
			? { spec: canonical, family: "mcp", tool: canonical, piTool: "mcp" }
			: unresolved();
	}
	if (connect !== undefined) return asServer(connect);
	if (describe !== undefined) {
		const canonical = resolveGatewayToolName(describe, server, registry);
		return canonical
			? { spec: canonical, family: "mcp", tool: canonical, piTool: "mcp" }
			: unresolved();
	}
	if (instructions !== undefined) return asServer(instructions);
	if (search !== undefined) return server ? asServer(server) : unresolved();
	if (server !== undefined) return asServer(server);
	return unresolved();
}

/**
 * Resolve a gateway tool reference to `mcp__server__tool`.
 * With `server`: raw-name match (exact + `-`→`_` normalization, mirroring the
 * adapter's getSingleToolMatch), then prefix-stripped forms.
 * Without `server`: registry wire-name hit, then unique-raw hit, then
 * longest-prefix split with the adapter's ambiguity guard.
 */
function resolveGatewayToolName(
	name: string,
	server: string | undefined,
	registry?: McpRegistry,
): string | undefined {
	const normalize = (s: string) => s.replace(/-/g, "_");
	if (!registry) return undefined;

	if (server) {
		const raws = registry.rawTools.get(server);
		if (!raws) return undefined;
		const hit = raws.find((r) => r === name || normalize(r) === normalize(name));
		if (hit) return `mcp__${server}__${hit}`;
		const prefix = sanitizeServerPrefix(server);
		if (name.startsWith(`${prefix}_`)) {
			const stripped = name.slice(prefix.length + 1);
			const rawHit = raws.find((r) => r === stripped || normalize(r) === normalize(stripped));
			return `mcp__${server}__${rawHit ?? stripped}`;
		}
		// Short form: the bare tool name relative to this server (e.g.
		// { server: "mempalace", tool: "search" } where the raw tool is "search").
		const expanded = `${prefix}_${name}`;
		const expandedHit = raws.find((r) => r === expanded || normalize(r) === normalize(expanded));
		if (expandedHit) return `mcp__${server}__${expandedHit}`;
		return undefined;
	}

	const direct = registry.wireToCanonical.get(name);
	if (direct) return direct;
	return splitByLongestPrefix(name, registry);
}

/** Longest sanitized-server-prefix split with the adapter's ambiguity guard. */
function splitByLongestPrefix(name: string, registry: McpRegistry): string | undefined {
	const candidates = registry.prefixes
		.filter((p) => name.startsWith(`${p.prefix}_`))
		.sort((a, b) => b.prefix.length - a.prefix.length);
	if (candidates.length === 0) return undefined;
	const best = candidates[0]!;
	if (candidates.some((c) => c.prefix === best.prefix && c.server !== best.server)) {
		return undefined; // ambiguous prefix — fail safe
	}
	return `mcp__${best.server}__${name.slice(best.prefix.length + 1)}`;
}
