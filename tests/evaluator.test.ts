import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluate } from "../evaluator.ts";
import { canonicalize, buildMcpRegistry } from "../canonicalize.ts";
import { loadRules } from "../loader.ts";
import { parseRuleSpec } from "../rules/parse.ts";
import type { CanonicalTarget, ParsedRule } from "../types.ts";

const CTX = { home: "/home/u", anchorDir: "/proj", cwd: "/proj" };

function rules(...specs: Array<[string, "allow" | "deny" | "ask"]>): ParsedRule[] {
	return specs.map(([spec, action]) => {
		const out = parseRuleSpec(spec, action, CTX);
		if (!out.ok) throw new Error(`bad test rule ${spec}: ${out.issue.message}`);
		return { ...out.rule, sources: [`/src/${action}.json`] };
	});
}

function bashTarget(command: string): CanonicalTarget {
	return canonicalize("bash", { command }, CTX);
}
function pathTarget(tool: "read" | "edit" | "write", path: string): CanonicalTarget {
	return canonicalize(tool, { path }, CTX);
}

// ---------------------------------------------------------------------------
// The six required table cases from the backlog.
// ---------------------------------------------------------------------------

test("TABLE 1: Bash(npm run *) matches `npm run test -- --watch` variants", () => {
	const r = rules(["Bash(npm run *)", "allow"]);
	assert.equal(evaluate(r, bashTarget("npm run test -- --watch")).action, "allow");
	assert.equal(evaluate(r, bashTarget("npm run build")).action, "allow");
	assert.equal(evaluate(r, bashTarget("npm run")).action, "allow");
	assert.equal(evaluate(r, bashTarget("npm runx")).action, "none");
});

test("TABLE 2: Bash(ls *) ≠ Bash(ls*)", () => {
	const spaced = rules(["Bash(ls *)", "allow"]);
	const glued = rules(["Bash(ls*)", "allow"]);
	assert.equal(evaluate(spaced, bashTarget("lsof")).action, "none");
	assert.equal(evaluate(glued, bashTarget("lsof")).action, "allow");
	assert.equal(evaluate(spaced, bashTarget("ls -la")).action, "allow");
	assert.equal(evaluate(glued, bashTarget("ls -la")).action, "allow");
});

test("TABLE 3: Edit(src/**) allow-vs-deny depth interplay", () => {
	const allow = rules(["Edit(src/**)", "allow"]);
	const deny = rules(["Edit(src/**)", "deny"]);
	// Allow: only <cwd>/src.
	assert.equal(evaluate(allow, pathTarget("edit", "/proj/src/a.ts")).action, "allow");
	assert.equal(evaluate(allow, pathTarget("edit", "/proj/deep/src/a.ts")).action, "none");
	// Deny: any depth.
	assert.equal(evaluate(deny, pathTarget("edit", "/proj/src/a.ts")).action, "deny");
	assert.equal(evaluate(deny, pathTarget("edit", "/proj/deep/src/a.ts")).action, "deny");
});

test("TABLE 4: mcp__mempalace__* matches BOTH the direct tool AND the gateway call", () => {
	const fixtureDir = new URL("./fixtures/", import.meta.url);
	const registry = buildMcpRegistry({
		configs: [JSON.parse(readFileSync(new URL("mcp-config.json", fixtureDir), "utf-8"))],
		caches: [],
	});
	const opts = { ...CTX, registry };
	const r = rules(["mcp__mempalace__*", "allow"]);

	const direct = canonicalize("mempalace_search", {}, opts); // direct-tool wire name
	assert.equal(direct.spec, "mcp__mempalace__search");
	assert.equal(evaluate(r, direct).action, "allow");

	const gateway = canonicalize("mcp", { tool: "search" }, opts); // gateway {tool:"search"}
	assert.equal(gateway.spec, "mcp__mempalace__search");
	assert.equal(evaluate(r, gateway).action, "allow");
});

test("TABLE 5: Read(.env) matches at any depth", () => {
	const r = rules(["Read(.env)", "deny"]);
	assert.equal(evaluate(r, pathTarget("read", "/proj/.env")).action, "deny");
	assert.equal(evaluate(r, pathTarget("read", "/proj/a/b/.env")).action, "deny");
	assert.equal(evaluate(r, pathTarget("read", "/other/.env")).action, "deny");
	assert.equal(evaluate(r, pathTarget("read", "/proj/.envrc")).action, "none");
});

test("TABLE 6: deny-in-claude-global beats allow-in-pi-local", async () => {
	const fixtureDir = new URL("./fixtures/", import.meta.url);
	const fixture = (name: string) => new URL(name, fixtureDir).pathname;
	const loaded = await loadRules({
		claudeProject: "/nonexistent/x",
		claudeLocal: "/nonexistent/x",
		claudeGlobal: fixture("claude-global.json"),
		piUser: "/nonexistent/x",
		piProject: "/nonexistent/x",
		piLocal: fixture("pi-local.json"),
		home: "/home/u",
		cwd: "/proj",
	});
	// claude-global denies Bash(rm -rf *); pi-local allows it.
	const verdict = evaluate(loaded.rules, bashTarget("rm -rf /tmp/x"));
	assert.equal(verdict.action, "deny");
	assert.equal(verdict.matchedRule?.spec, "Bash(rm -rf *)");
	assert.equal(verdict.source, fixture("claude-global.json"));
});

// ---------------------------------------------------------------------------
// Cross-tool matrix + safety hook.
// ---------------------------------------------------------------------------

test("Read deny blocks Edit/Write on the path (incl. file creation)", () => {
	const r = rules(["Read(.env)", "deny"]);
	assert.equal(evaluate(r, pathTarget("write", "/proj/.env")).action, "deny");
	assert.equal(evaluate(r, pathTarget("edit", "/proj/.env")).action, "deny");
	// Read allow does NOT grant write.
	const allow = rules(["Read(.env)", "allow"]);
	assert.equal(evaluate(allow, pathTarget("write", "/proj/.env")).action, "none");
});

test("Edit allow grants read on the path", () => {
	const r = rules(["Edit(src/**)", "allow"]);
	assert.equal(evaluate(r, pathTarget("read", "/proj/src/a.ts")).action, "allow");
});

test("safety hook: FS1 default is pass-through; a blocking hook wins over allow", () => {
	const r = rules(["Bash(*)", "allow"]);
	assert.equal(evaluate(r, bashTarget("anything")).action, "allow");
	const verdict = evaluate(r, bashTarget("anything"), {
		checkSafety: () => ({ blocked: true, reason: "catastrophic" }),
	});
	assert.equal(verdict.action, "deny");
	assert.equal(verdict.source, "safety");
	assert.equal(verdict.safetyReason, "catastrophic");
});

// ---------------------------------------------------------------------------
// Property tests (seeded LCG — deterministic, no dependencies).
// ---------------------------------------------------------------------------

function lcg(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (1664525 * state + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

function shuffle<T>(items: T[], rand: () => number): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
}

const PROPERTY_RULES: ParsedRule[] = rules(
	["Bash(npm run build)", "allow"], // exact
	["Bash(npm run *)", "allow"], // broad allow
	["Bash(npm *)", "ask"], // ask
	["Bash(*)", "deny"], // deny-all
	["Read(.env)", "deny"], // unrelated family
);

test("PROPERTY: deny dominance holds under rule permutation", () => {
	const rand = lcg(42);
	const target = bashTarget("npm run build");
	for (let i = 0; i < 300; i++) {
		const verdict = evaluate(shuffle(PROPERTY_RULES, rand), target);
		assert.equal(verdict.action, "deny", "deny must always win");
		assert.equal(verdict.matchedRule?.spec, "Bash(*)");
	}
});

test("PROPERTY: ask beats allow under permutation", () => {
	const rand = lcg(7);
	const target = bashTarget("npm run dev");
	const noDeny = PROPERTY_RULES.filter((r) => r.action !== "deny");
	for (let i = 0; i < 300; i++) {
		const verdict = evaluate(shuffle(noDeny, rand), target);
		assert.equal(verdict.action, "ask", "ask must beat allow");
		assert.equal(verdict.matchedRule?.spec, "Bash(npm *)");
	}
});

test("PROPERTY: first-match within an action list is stable under identity", () => {
	const first = rules(["Bash(npm run *)", "deny"], ["Bash(npm *)", "deny"]);
	const target = bashTarget("npm run build");
	const verdict = evaluate(first, target);
	assert.equal(verdict.matchedRule?.spec, "Bash(npm run *)", "first matching deny is reported");
	const swapped = [...first].reverse();
	assert.equal(evaluate(swapped, target).matchedRule?.spec, "Bash(npm *)");
	// Outcome is identical either way.
	assert.equal(evaluate(swapped, target).action, evaluate(first, target).action);
});

test("PROPERTY: evaluation is deterministic for identical input", () => {
	const rand = lcg(99);
	const target = bashTarget("git push origin main");
	const r = rules(["Bash(git * main)", "ask"], ["Bash(git push *)", "ask"]);
	const first = evaluate(r, target);
	for (let i = 0; i < 100; i++) {
		assert.deepEqual(evaluate(r, target), first);
	}
	assert.ok(rand() >= 0);
});

// ---------------------------------------------------------------------------
// FS2: ignoreAllow (production-support does not consult allow rules).
// ---------------------------------------------------------------------------

test("FS2 ignoreAllow: allow rules skipped, deny/ask unaffected", () => {
	const r = rules(
		["Bash(npm *)", "allow"],
		["Bash(npm run *)", "ask"],
		["Bash(rm *)", "deny"],
	);
	const npmRun = bashTarget("npm run build");
	assert.equal(evaluate(r, npmRun).action, "ask", "ask beats allow normally");
	assert.equal(evaluate(r, npmRun, { ignoreAllow: true }).action, "ask", "ask unaffected");
	assert.equal(evaluate(r, bashTarget("npm why")).action, "allow");
	assert.equal(evaluate(r, bashTarget("npm why"), { ignoreAllow: true }).action, "none", "allow skipped");
	const rm = bashTarget("rm -rf build");
	assert.equal(evaluate(r, rm).action, "deny");
	assert.equal(evaluate(r, rm, { ignoreAllow: true }).action, "deny", "deny unaffected");
});
