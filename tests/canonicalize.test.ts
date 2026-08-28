import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildMcpRegistry, canonicalize, sanitizeServerPrefix } from "../canonicalize.ts";
import type { CanonicalTarget, McpRegistry } from "../types.ts";

const fixtureDir = new URL("./fixtures/", import.meta.url);

function loadJson(name: string): unknown {
	return JSON.parse(readFileSync(new URL(name, fixtureDir), "utf-8"));
}

/** Research-model registry: server "mempalace" with short raw tool names. */
const shortNames: McpRegistry = buildMcpRegistry({
	configs: [loadJson("mcp-config.json")],
	caches: [],
});

/** Real-world registry: raw tools already carry the server prefix. */
const prefixedNames: McpRegistry = buildMcpRegistry({
	caches: [loadJson("mcp-cache.json")],
});

const opts = { cwd: "/proj", home: "/home/u", registry: shortNames };

function canon(toolName: string, input: Record<string, unknown>, registry: McpRegistry = shortNames): CanonicalTarget {
	return canonicalize(toolName, input, { cwd: "/proj", home: "/home/u", registry });
}

test("pi builtin mapping (charge §2: bash→Bash, read→Read, …)", () => {
	const bash = canon("bash", { command: "npm run build" });
	assert.deepEqual([bash.family, bash.tool, bash.command], ["bash", "Bash", "npm run build"]);

	const read = canon("read", { path: "src/a.ts" });
	assert.deepEqual([read.family, read.tool, read.path], ["path", "Read", "/proj/src/a.ts"]);

	const edit = canon("edit", { path: "/abs/x.ts" });
	assert.deepEqual([edit.family, edit.tool], ["path", "Edit"]);

	const write = canon("write", { path: "~/notes.txt" });
	assert.equal(write.path, "/home/u/notes.txt");
	assert.equal(write.tool, "Write");

	const wf = canon("web_fetch", { url: "https://API.Example.com./x" });
	assert.deepEqual([wf.family, wf.tool, wf.hostname], ["webfetch", "WebFetch", "api.example.com"]);

	const badUrl = canon("web_fetch", { url: "not a url" });
	assert.equal(badUrl.hostname, undefined);

	const ws = canon("web_search", { query: "x" });
	assert.deepEqual([ws.family, ws.tool], ["websearch", "WebSearch"]);

	const sub = canon("subagent", { agent: "worker", task: "t" });
	assert.deepEqual([sub.family, sub.tool, sub.agent], ["agent", "Agent", "worker"]);
});

test("read-family pi tools (grep/find/ls) canonicalize to Read (Claude parity)", () => {
	assert.equal(canon("grep", { pattern: "x", path: "src" }).tool, "Read");
	assert.equal(canon("find", { path: "src" }).tool, "Read");
	assert.equal(canon("ls", { path: "." }).tool, "Read");
	// No path given: the scan root (cwd) is the target.
	assert.equal(canon("ls", {}).path, "/proj");
});

test("direct MCP tools map via the registry — short raw names (research model)", () => {
	const t = canon("mempalace_search", {});
	assert.deepEqual([t.family, t.spec], ["mcp", "mcp__mempalace__search"]);
});

test("direct MCP tools map via the registry — prefixed raw names (real world)", () => {
	const t = canonicalize("mempalace_mempalace_search", {}, { cwd: "/proj", home: "/home/u", registry: prefixedNames });
	assert.deepEqual([t.family, t.spec], ["mcp", "mcp__mempalace__mempalace_search"]);
});

test("gateway mcp tool: tool/server shapes (adapter dispatch order)", () => {
	// {tool:"search"} — unique raw name resolves without a server.
	assert.equal(canon("mcp", { tool: "search" }).spec, "mcp__mempalace__search");
	// With explicit server (raw name + short form).
	assert.equal(canon("mcp", { tool: "search", server: "mempalace" }).spec, "mcp__mempalace__search");
	// Prefixed wire form of the raw "search" tool, no server needed.
	assert.equal(canon("mcp", { tool: "mempalace_search" }).spec, "mcp__mempalace__search");
	// Real-world: raw name IS mempalace_search (prefixedNames registry).
	const real = canonicalize("mcp", { tool: "mempalace_search", server: "mempalace" }, { cwd: "/proj", home: "/home/u", registry: prefixedNames });
	assert.equal(real.spec, "mcp__mempalace__mempalace_search");
	const realShort = canonicalize("mcp", { tool: "search", server: "mempalace" }, { cwd: "/proj", home: "/home/u", registry: prefixedNames });
	assert.equal(realShort.spec, "mcp__mempalace__mempalace_search", "short form expands to the server-prefixed raw name");
});

test("gateway mcp tool: meta actions", () => {
	assert.equal(canon("mcp", { connect: "mempalace" }).spec, "mcp__mempalace");
	assert.equal(canon("mcp", { server: "mempalace" }).spec, "mcp__mempalace");
	assert.equal(canon("mcp", { instructions: "mempalace" }).spec, "mcp__mempalace");
	assert.equal(canon("mcp", { search: "query", server: "mempalace" }).spec, "mcp__mempalace");
	assert.equal(canon("mcp", { describe: "search" }).spec, "mcp__mempalace__search");
	assert.equal(canon("mcp", { action: "auth-start", server: "mempalace" }).spec, "mcp__mempalace");
	// Server-less meta actions canonicalize to the whole gateway tool.
	assert.equal(canon("mcp", {}).spec, "mcp");
	const unres = canon("mcp", { search: "query" });
	assert.deepEqual([unres.family, unres.tool], ["other", "mcp"]);
	const unresTool = canon("mcp", { tool: "no_such_tool_anywhere" });
	assert.deepEqual([unresTool.family, unresTool.tool], ["other", "mcp"]);
});

test("mcp prefix mode \"mcp\" wires canonicalize without registry hits", () => {
	const registry = buildMcpRegistry({
		configs: [{ mcpServers: { mempalace: { directTools: ["search"] } }, settings: { toolPrefix: "mcp" } }],
	});
	const t = canonicalize("mcp__mempalace_search", {}, { registry });
	assert.equal(t.spec, "mcp__mempalace__search");
	// Already-canonical names pass through unchanged.
	const canon2 = canonicalize("mcp__mempalace__search", {}, { registry });
	assert.equal(canon2.spec, "mcp__mempalace__search");
});

test("ambiguous/unknown direct tools fail safe to whole-tool 'other'", () => {
	const registry = buildMcpRegistry({
		configs: [{ mcpServers: { "foo-mcp": {}, "foo": {} } }], // both sanitize to distinct prefixes
		caches: [{ servers: { a: { tools: [{ name: "shared" }] }, b: { tools: [{ name: "shared" }] } } }],
	});
	// Raw name claimed by two servers -> ambiguous, not mapped.
	const ambiguous = canonicalize("shared", {}, { registry });
	assert.equal(ambiguous.family, "other");
	// Longest-prefix ambiguity guard.
	const guard = buildMcpRegistry({ configs: [{ mcpServers: { x: {}, y: {} } }] });
	assert.equal(canonicalize("x_tool", {}, { registry: guard }).spec, "mcp__x__tool");
	// Genuinely unknown names stay whole-tool.
	assert.equal(canonicalize("totally_unknown", {}, { registry: guard }).family, "other");
});

test("known pi tools never canonicalize as MCP even with colliding registry entries", () => {
	const registry = buildMcpRegistry({
		caches: [{ servers: { s: { tools: [{ name: "todo" }] } } }],
	});
	const t = canonicalize("todo", { subject: "x" }, { registry });
	assert.deepEqual([t.family, t.tool], ["other", "todo"]);
});

test("sanitizeServerPrefix matches the adapter's implementation", () => {
	// [A-Za-z0-9_-] kept; everything else becomes _<hex>_.
	assert.equal(sanitizeServerPrefix("mempalace"), "mempalace");
	assert.equal(sanitizeServerPrefix("foo.bar"), "foo_2e_bar");
	assert.equal(sanitizeServerPrefix("x"), "x");
});

// ---------------------------------------------------------------------------
// R4 (review window): bare gateway tool name not in the registry for a KNOWN
// server → attributed to the server (mcp__S, family mcp) with the unresolved
// marker; unknown server stays whole-tool.
// ---------------------------------------------------------------------------

test("R4: gateway bare-name miss on a known server falls back to mcp__S (unresolved)", () => {
	const t = canon("mcp", { server: "mempalace", tool: "no_such_tool" });
	assert.equal(t.spec, "mcp__mempalace");
	assert.equal(t.family, "mcp");
	assert.equal(t.unresolved, true, "must be marked so persistence refuses it");
	// describe path behaves the same
	const d = canon("mcp", { server: "mempalace", describe: "no_such_tool" });
	assert.equal(d.spec, "mcp__mempalace");
	assert.equal(d.unresolved, true);
	// Unknown server stays whole-tool (nothing to attribute to)
	const ghost = canon("mcp", { server: "ghost", tool: "x" });
	assert.deepEqual([ghost.family, ghost.tool], ["other", "mcp"]);
	assert.notEqual(ghost.unresolved, true);
});
