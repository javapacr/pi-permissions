import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRuleSpec } from "../rules/parse.ts";

const ctx = { home: "/home/u", anchorDir: "/proj", cwd: "/proj" };

function parse(spec: string, action: "allow" | "deny" | "ask" = "allow") {
	return parseRuleSpec(spec, action, ctx);
}

test("bare tool names parse as whole-tool rules", () => {
	const cases: Array<[string, string, string]> = [
		["Bash", "bash", "Bash"],
		["Read", "path", "Read"],
		["Edit", "path", "Edit"],
		["Write", "path", "Write"],
		["WebFetch", "webfetch", "WebFetch"],
		["WebSearch", "websearch", "WebSearch"],
		["Agent", "agent", "Agent"],
		["Todo", "other", "Todo"],
		["Grep", "path", "Read"], // folds into Read (Claude parity)
	];
	for (const [spec, family, tool] of cases) {
		const out = parse(spec);
		assert.ok(out.ok, `${spec} should parse`);
		assert.equal(out.rule.family, family, `${spec} family`);
		assert.equal(out.rule.tool, tool, `${spec} tool`);
	}
});

test("Bash specifiers incl. :* and whole-tool forms", () => {
	const glob = parse("Bash(npm run:*)");
	assert.ok(glob.ok && glob.rule.glob === "npm run:*");
	assert.equal(glob.ok && glob.rule.family, "bash");

	const star = parse("Bash(*)");
	assert.ok(star.ok && star.rule.glob === undefined, "Bash(*) ≡ Bash (whole tool)");

	const bare = parse("Bash");
	assert.ok(bare.ok && bare.rule.glob === undefined);

	const ps = parse("PowerShell(Get-ChildItem *)");
	assert.ok(ps.ok && ps.rule.tool === "PowerShell" && ps.rule.glob === "Get-ChildItem *");
});

test("path specifiers compile for Read/Edit (and Grep folds to Read)", () => {
	const read = parse("Read(.env)");
	assert.ok(read.ok && read.rule.family === "path" && read.rule.tool === "Read" && read.rule.path !== undefined);
	const edit = parse("Edit(src/**)", "deny");
	assert.ok(edit.ok && edit.rule.tool === "Edit" && edit.rule.path !== undefined);
	const grep = parse("Grep(**/*.env)", "deny");
	assert.ok(grep.ok && grep.rule.tool === "Read");
});

test("Write(path) is rejected (never consulted in Claude)", () => {
	const out = parse("Write(/x/y)");
	assert.ok(!out.ok);
	assert.match(out.issue.message, /never consulted/);
});

test("WebFetch domain forms", () => {
	const one = parse("WebFetch(domain:example.com)");
	assert.ok(one.ok && JSON.stringify(one.ok ? one.rule.domains : []) === JSON.stringify(["example.com"]));
	const list = parse("WebFetch(domain:a.com,b.com)");
	assert.ok(list.ok && JSON.stringify(list.ok ? list.rule.domains : []) === JSON.stringify(["a.com", "b.com"]));
	const noPrefix = parse("WebFetch(a.com)");
	assert.ok(noPrefix.ok && JSON.stringify(noPrefix.ok ? noPrefix.rule.domains : []) === JSON.stringify(["a.com"]));
	const star = parse("WebFetch(domain:*)");
	assert.ok(star.ok && JSON.stringify(star.ok ? star.rule.domains : []) === JSON.stringify(["*"]));
});

test("mcp rule forms", () => {
	const server = parse("mcp__mempalace");
	assert.ok(server.ok && server.rule.mcpServer === "mempalace" && server.rule.mcpTool === undefined);
	const tool = parse("mcp__mempalace__search");
	assert.ok(tool.ok && tool.rule.mcpServer === "mempalace" && tool.rule.mcpTool === "search");
	const glob = parse("mcp__mempalace__*");
	assert.ok(glob.ok && glob.rule.mcpTool === "*");
	const multi = parse("mcp__server__a__b");
	assert.ok(multi.ok && multi.rule.mcpServer === "server" && multi.rule.mcpTool === "a__b");

	// Rejected: parentheses, mid-globs, missing parts.
	assert.ok(!parse("mcp__x(y)").ok);
	assert.ok(!parse("mcp__s__a*").ok);
	assert.ok(!parse("mcp__").ok);
});

test("Agent rules", () => {
	const named = parse("Agent(worker)", "deny");
	assert.ok(named.ok && named.rule.agentName === "worker");
	assert.ok(!parse("Agent(model:opus)").ok, "param form is parking lot");
	assert.ok(!parse("Agent(*)").ok, "no documented wildcard");
});

test("tool-name-position globs: deny/ask only", () => {
	const denyAll = parse("*", "deny");
	assert.ok(denyAll.ok && denyAll.rule.toolGlob === "*");
	const askAll = parse("*", "ask");
	assert.ok(askAll.ok && askAll.rule.toolGlob === "*");
	assert.ok(!parse("*", "allow").ok, "allow-side unanchored glob skipped");

	const denyMcp = parse("mcp__*", "deny");
	assert.ok(denyMcp.ok && denyMcp.rule.toolGlob === "mcp__*");
	assert.ok(!parse("mcp__*", "allow").ok);
	assert.ok(!parse("B*", "deny").ok, "partial tool-name globs unsupported");
});

test("invalid specs are rejected with issues, never silently", () => {
	const rejects: Array<[string, RegExp]> = [
		["", /empty/],
		["WebSearch(x)", /no specifier/],
		["Todo(x)", /unknown tool/],
		["Bash(", /malformed/],
		["Bash()", /empty specifier/],
		["Read()", /empty specifier/],
	];
	for (const [spec, re] of rejects) {
		const out = parse(spec);
		assert.ok(!out.ok, `${JSON.stringify(spec)} must be rejected`);
		assert.match(out.issue.message, re);
	}
});

test("parser is action-aware where required (deny boost decided at compile)", () => {
	const allow = parse("Edit(src/**)", "allow");
	const deny = parse("Edit(src/**)", "deny");
	assert.ok(allow.ok && deny.ok);
	// Both compile; the any-depth flag differs (verified in paths.test.ts).
});
