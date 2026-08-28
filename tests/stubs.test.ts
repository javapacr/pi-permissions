import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as canonicalize from "../canonicalize.ts";
import * as loader from "../loader.ts";
import * as bash from "../rules/bash.ts";
import * as paths from "../rules/paths.ts";
import * as webfetch from "../rules/webfetch.ts";
import * as mcp from "../rules/mcp.ts";
import * as agent from "../rules/agent.ts";
import * as parse from "../rules/parse.ts";
import * as evaluator from "../evaluator.ts";
import * as safety from "../safety.ts";
import * as ask from "../ask.ts";
import * as persist from "../persist.ts";

const implemented: Array<[string, Record<string, unknown>, string]> = [
	["canonicalize.canonicalize", canonicalize, "canonicalize"],
	["loader.loadRules", loader, "loadRules"],
	["rules/bash.matchBashRule", bash, "matchBashRule"],
	["rules/paths.matchPathRule", paths, "matchPathRule"],
	["rules/webfetch.matchDomainRule", webfetch, "matchDomainRule"],
	["rules/mcp.matchMcpRule", mcp, "matchMcpRule"],
	["rules/agent.matchAgentRule", agent, "matchAgentRule"],
	["rules/parse.parseRuleSpec", parse, "parseRuleSpec"],
	["evaluator.evaluate", evaluator, "evaluate"],
	["safety.checkSafety", safety, "checkSafety"],
	["ask.resolveAsk", ask, "resolveAsk"],
	["persist.persistAllowRule", persist, "persistAllowRule"],
];

test("every FS1+FS3 module exports its named function (implemented)", () => {
	for (const [label, mod, fnName] of implemented) {
		assert.equal(typeof mod[fnName], "function", `${label} must export function ${fnName}`);
	}
});

test("FS3 modules no longer throw (stubs filled by the FS2+FS3 release)", () => {
	// The FS0 throw-markers are gone. Safety smoke with a minimal canonical
	// target; ask/persist behavior is validated in their own test files.
	assert.doesNotThrow(() =>
		safety.checkSafety(
			{ spec: "Read(/x)", family: "path", tool: "Read", piTool: "read", path: "/x" },
			{ home: "/h", protectedPaths: [] },
		));
});

test("reference/ bridge files exist with provenance headers", () => {
	for (const file of ["converter.ts", "enforcer.ts", "loader.ts"]) {
		const url = new URL(`../reference/${file}`, import.meta.url);
		assert.ok(existsSync(url), `reference/${file} must exist`);
		const text = readFileSync(url, "utf-8");
		assert.ok(
			text.includes("REFERENCE ONLY — grafted from javapacr/pi-claude-permissions-bridge"),
			`reference/${file} must carry the provenance header`,
		);
	}
});
