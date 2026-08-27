import assert from "node:assert/strict";
import { test } from "node:test";
import { matchMcpRule } from "../rules/mcp.ts";
import { matchAgentRule } from "../rules/agent.ts";
import type { CanonicalTarget } from "../types.ts";

function mcpTarget(tool: string): CanonicalTarget {
	return { spec: tool, family: "mcp", tool, piTool: "mcp" };
}

function agentTarget(agent?: string): CanonicalTarget {
	return { spec: agent ? `Agent(${agent})` : "Agent", family: "agent", tool: "Agent", piTool: "subagent", agent };
}

test("mcp literal-prefix rule (artifact §3, MCP row)", () => {
	// Whole server.
	assert.equal(matchMcpRule({ server: "mempalace" }, mcpTarget("mcp__mempalace")), true);
	assert.equal(matchMcpRule({ server: "mempalace" }, mcpTarget("mcp__mempalace__search")), true);
	assert.equal(matchMcpRule({ server: "mempalace" }, mcpTarget("mcp__mempalace__diary_write")), true);
	assert.equal(matchMcpRule({ server: "mempalace" }, mcpTarget("mcp__mempalace_2")), false);
	assert.equal(matchMcpRule({ server: "mempalace" }, mcpTarget("mcp__other__search")), false);

	// Wildcard equivalent.
	assert.equal(matchMcpRule({ server: "mempalace", tool: "*" }, mcpTarget("mcp__mempalace__search")), true);
	assert.equal(matchMcpRule({ server: "mempalace", tool: "*" }, mcpTarget("mcp__mempalace")), true);
	assert.equal(matchMcpRule({ server: "mempalace", tool: "*" }, mcpTarget("mcp__mempalacex__y")), false);

	// Exact tool.
	assert.equal(matchMcpRule({ server: "mempalace", tool: "search" }, mcpTarget("mcp__mempalace__search")), true);
	assert.equal(matchMcpRule({ server: "mempalace", tool: "search" }, mcpTarget("mcp__mempalace__diary_write")), false);

	// Case-sensitive server names.
	assert.equal(matchMcpRule({ server: "MemPalace" }, mcpTarget("mcp__mempalace__search")), false);
});

test("mcp rules only match mcp-family targets", () => {
	const bash: CanonicalTarget = { spec: "Bash(ls)", family: "bash", tool: "Bash", piTool: "bash", command: "ls" };
	assert.equal(matchMcpRule({ server: "mempalace" }, bash), false);
});

test("agent rules (artifact §3, Agent row)", () => {
	assert.equal(matchAgentRule("worker", agentTarget("worker")), true);
	assert.equal(matchAgentRule("worker", agentTarget("reviewer")), false);
	assert.equal(matchAgentRule(undefined, agentTarget("worker")), true); // bare Agent = any
	assert.equal(matchAgentRule(undefined, agentTarget(undefined)), true);
	assert.equal(matchAgentRule("worker", agentTarget(undefined)), false);
	// Agent rules do not match non-agent targets.
	const read: CanonicalTarget = { spec: "Read(/x)", family: "path", tool: "Read", piTool: "read", path: "/x" };
	assert.equal(matchAgentRule(undefined, read), false);
});
