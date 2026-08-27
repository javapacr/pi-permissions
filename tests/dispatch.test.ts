import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../evaluator.ts";
import { canonicalize, buildMcpRegistry } from "../canonicalize.ts";
import { parseRuleSpec } from "../rules/parse.ts";
import type { CanonicalTarget, ParsedRule } from "../types.ts";

const CTX = { home: "/home/u", anchorDir: "/proj", cwd: "/proj" };

function rule(spec: string, action: "allow" | "deny" | "ask" = "allow"): ParsedRule {
	const out = parseRuleSpec(spec, action, CTX);
	if (!out.ok) throw new Error(`bad test rule: ${out.issue.message}`);
	return { ...out.rule, sources: ["/src/test.json"] };
}

function target(toolName: string, input: Record<string, unknown>, registry?: Parameters<typeof buildMcpRegistry>[0]): CanonicalTarget {
	return canonicalize(toolName, input, registry ? { ...CTX, registry: buildMcpRegistry(registry) } : CTX);
}

test("evaluator dispatch: websearch whole-tool", () => {
	const r = rule("WebSearch", "deny");
	assert.equal(evaluate([r], target("web_search", { query: "x" })).action, "deny");
	assert.equal(evaluate([r], target("bash", { command: "ls" })).action, "none");
});

test("evaluator dispatch: other-family whole-tool rules", () => {
	const r = rule("Todo", "ask");
	assert.equal(evaluate([r], target("todo", { subject: "x" })).action, "ask");
	assert.equal(evaluate([r], target("intercom", {})).action, "none");
	// The unresolved gateway tool is governed by bare `mcp`.
	const denyMcp = rule("mcp", "deny");
	assert.equal(evaluate([denyMcp], target("mcp", { search: "q" })).action, "deny");
	assert.equal(evaluate([denyMcp], target("mcp", { server: "x" })).action, "none", "server-scoped calls are mcp-family, not `mcp`");
});

test("evaluator dispatch: mcp rules via canonical targets", () => {
	const registry = { configs: [{ mcpServers: { mempalace: { directTools: ["search"] } } }] };
	const allow = rule("mcp__mempalace");
	assert.equal(evaluate([allow], target("mempalace_search", {}, registry)).action, "allow");
	assert.equal(evaluate([allow], target("mcp", { tool: "search" }, registry)).action, "allow");
	assert.equal(evaluate([allow], target("mcp", { connect: "mempalace" }, registry)).action, "allow");
	const deny = rule("mcp__other__*", "deny");
	assert.equal(evaluate([deny], target("mcp", { connect: "mempalace" }, registry)).action, "none");
});

test("evaluator dispatch: webfetch whole-tool vs domains", () => {
	const whole = rule("WebFetch", "deny");
	assert.equal(evaluate([whole], target("web_fetch", { url: "https://x.com/a" })).action, "deny");
	const scoped = rule("WebFetch(domain:example.com)", "allow");
	assert.equal(evaluate([scoped], target("web_fetch", { url: "https://example.com/a" })).action, "allow");
	assert.equal(evaluate([scoped], target("web_fetch", { url: "https://other.com/a" })).action, "none");
	// Unparseable URL: hostname undefined — only whole-tool rules match.
	assert.equal(evaluate([scoped], target("web_fetch", { url: "::bad::" })).action, "none");
});

test("evaluator dispatch: whole-tool bash and path rules", () => {
	assert.equal(evaluate([rule("Bash")], target("bash", { command: "anything" })).action, "allow");
	assert.equal(evaluate([rule("Read")], target("read", { path: "/any/x" })).action, "allow");
	assert.equal(evaluate([rule("Read")], target("grep", { pattern: "x", path: "/any" })).action, "allow", "read-family folds into Read");
	// Bare Write rules exist and match write targets only.
	assert.equal(evaluate([rule("Write")], target("write", { path: "/x" })).action, "allow");
	assert.equal(evaluate([rule("Write")], target("edit", { path: "/x" })).action, "none");
});

test("evaluator: PowerShell rules match case-insensitively", () => {
	const r = rule("PowerShell(Get-ChildItem *)", "deny");
	const ps = target("powershell", { command: "get-childitem -Recurse" });
	assert.equal(evaluate([r], ps).action, "deny");
});

test("canonicalizer: sanitized-prefix collision fails safe", () => {
	// "a.b" sanitizes to "a_2e_b" — same prefix as the literal server "a_2e_b".
	const registry = buildMcpRegistry({
		configs: [{ mcpServers: { "a.b": { directTools: ["t1"] }, "a_2e_b": { directTools: ["t2"] } } }],
	});
	const t = canonicalize("a_2e_b_t1", {}, { registry });
	// Exact wire registration for raw "t1" of server "a.b" wins (registered
	// first); ambiguity only guards the unregistered longest-prefix path.
	assert.equal(t.spec, "mcp__a.b__t1");
	const unknown = canonicalize("a_2e_b_nope", {}, { registry });
	assert.equal(unknown.family, "other", "prefix collision with no registry hit fails safe");
});

test("canonicalizer: prefix mode \"none\" maps unique raw names directly", () => {
	const registry = buildMcpRegistry({
		configs: [{ mcpServers: { solo: { directTools: ["alpha"], other: { directTools: ["beta"] } } }, settings: { toolPrefix: "none" } }],
	});
	assert.equal(canonicalize("alpha", {}, { registry }).spec, "mcp__solo__alpha");
});

test("path rules: deny depth boost + named-root match at depth", () => {
	const r = rule("Read(docs/**)", "deny");
	// cwd-relative deny: src dir at any depth, including the dir itself.
	assert.equal(evaluate([r], target("read", { path: "/x/deep/docs" })).action, "deny");
	assert.equal(evaluate([r], target("read", { path: "/x/deep/docs/a.md" })).action, "deny");
});
