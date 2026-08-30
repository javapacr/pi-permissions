import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRules } from "../loader.ts";

const fixtureDir = new URL("./fixtures/", import.meta.url);
const fixture = (name: string) => new URL(name, fixtureDir).pathname;

const paths = {
	claudeProject: fixture("claude-project.json"),
	claudeLocal: fixture("claude-local.json"),
	claudeGlobal: fixture("claude-global.json"),
	piUser: fixture("pi-user.json"),
	piProject: fixture("pi-project.json"),
	piLocal: fixture("pi-local.json"),
	home: "/home/u",
	cwd: "/proj",
};

test("dual-source loader: union of all six scopes", async () => {
	const loaded = await loadRules(paths);
	assert.equal(loaded.sources.length, 6);
	// claude-project: 2 allow + 1 deny + 1 invalid (Write) ; claude-local: 1 ask ;
	// claude-global: 1 allow + 1 deny ; pi-user: 1 allow ; pi-project: 1 allow ;
	// pi-local: 2 allow. One invalid spec (Write(...)) is counted, not parsed.
	assert.equal(loaded.rules.length, 10);
	assert.equal(loaded.issues.length, 1);
	assert.match(loaded.issues[0]!.message, /never consulted/);
	assert.equal(loaded.issues[0]!.file, paths.claudeProject);
});

test("scope order is claude-project, claude-local, claude-global, then pi", async () => {
	const loaded = await loadRules(paths);
	assert.deepEqual(
		loaded.sources.map((s) => s.scope),
		["claude-project", "claude-local", "claude-global", "pi-user", "pi-project", "pi-local"],
	);
});

test("dedupe keeps one rule and records every source (provenance)", async () => {
	const loaded = await loadRules({
		...paths,
		claudeGlobal: fixture("claude-project.json"), // same allow rules as claude-project
	});
	const npmRun = loaded.rules.find((r) => r.spec === "Bash(npm run *)");
	assert.ok(npmRun, "rule present");
	assert.deepEqual(npmRun.sources, [paths.claudeProject, fixture("claude-project.json")]);
});

test("pi config keys parsed and merged local > project > user", async () => {
	const loaded = await loadRules(paths);
	assert.equal(loaded.keys.defaultMode, "bypassPermissions"); // pi-local wins
	assert.deepEqual(loaded.keys.protectedPaths, ["~/.ssh", "~/.gnupg"]); // pi-user only
	assert.deepEqual(loaded.keys.productionSupport?.readOnlyBash, ["git status", "kubectl get"]); // pi-project only
	assert.deepEqual(loaded.keys.children, { policy: "inherit" }); // pi-local
});

test("missing files are absent scopes, not errors", async () => {
	const loaded = await loadRules({
		...paths,
		claudeLocal: "/nonexistent/.claude/settings.local.json",
		piProject: "/nonexistent/.pi/permissions.json",
		piLocal: "/nonexistent/.pi/permissions.local.json",
	});
	assert.equal(loaded.sources.length, 3);
	assert.equal(loaded.keys.defaultMode, "default"); // only pi-user carries keys now
});

test("broken arrays produce counted issues", async () => {
	const loaded = await loadRules({
		...paths,
		piProject: fixture("broken.json"),
	});
	const notArray = loaded.issues.find((i) => /not an array/.test(i.message));
	assert.ok(notArray, "allow=<object> flagged");
	const notString = loaded.issues.find((i) => /not a string/.test(i.message));
	assert.ok(notString, "non-string entry flagged");
});

test("loader never reads real paths when given injected ones", async () => {
	// Every path points at fixtures or nonexistent files — a load under this
	// config must be hermetic (the FS0 probe caveat, fixed by FS1).
	const loaded = await loadRules({
		...paths,
		claudeProject: "/nonexistent/x",
		claudeLocal: "/nonexistent/x",
		claudeGlobal: "/nonexistent/x",
		piUser: "/nonexistent/x",
		piProject: "/nonexistent/x",
		piLocal: "/nonexistent/x",
	});
	assert.deepEqual(loaded, { rules: [], issues: [], sources: [], keys: {} });
});

// ---------------------------------------------------------------------------
// R6 (review window): a corrupted scope file is an ISSUE, never a silent
// scope loss — other scopes still load, ⚠N + 🩺 surface the file.
// ---------------------------------------------------------------------------

test("R6: unparsable scope JSON surfaces as an issue and other scopes still load", async () => {
	const loaded = await loadRules({ ...paths, claudeProject: fixture("corrupt-scope.json") });
	// claude-project's 3 valid rules are gone (treated as absent), but every
	// other scope still contributes: 10 - 3 = 7 rules.
	assert.equal(loaded.rules.length, 7);
	// Two issues: the fixture's pre-existing invalid Write spec moved? No —
	// that spec lived in claude-project, which no longer parses. Exactly one
	// issue: the corrupt scope itself.
	assert.equal(loaded.issues.length, 1);
	assert.equal(loaded.issues[0]!.file, fixture("corrupt-scope.json"));
	assert.match(loaded.issues[0]!.message, /unparsable JSON/);
	assert.match(loaded.issues[0]!.message, /NOT loaded/);
	// The scope is still listed as a source (it exists and was read).
	assert.ok(loaded.sources.some((s) => s.file === fixture("corrupt-scope.json") && s.scope === "claude-project"));
});
