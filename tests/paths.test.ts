import assert from "node:assert/strict";
import { test } from "node:test";
import { compilePathPattern, matchPathRule } from "../rules/paths.ts";

const ctx = { home: "/home/u", anchorDir: "/proj", cwd: "/proj" };

function check(pattern: string, action: "allow" | "deny" | "ask", target: string): boolean {
	return matchPathRule(compilePathPattern(pattern, action, ctx), target);
}

test("bare names match at any depth (Read(.env) ≡ Read(**/.env))", () => {
	assert.equal(check(".env", "deny", "/proj/.env"), true);
	assert.equal(check(".env", "deny", "/proj/a/b/.env"), true);
	assert.equal(check(".env", "deny", "/elsewhere/.env"), true);
	assert.equal(check(".env", "deny", "/proj/.envrc"), false);
	assert.equal(check(".env", "deny", "/proj/a/env"), false);
});

test("Edit(src/**) allow-vs-deny depth interplay (Claude asymmetry)", () => {
	// Allow: only <cwd>/src (and below).
	assert.equal(check("src/**", "allow", "/proj/src/a.ts"), true);
	assert.equal(check("src/**", "allow", "/proj/src/x/y.ts"), true);
	assert.equal(check("src/**", "allow", "/proj/src"), true); // named root itself
	assert.equal(check("src/**", "allow", "/proj/deep/src/a.ts"), false);
	assert.equal(check("src/**", "allow", "/proj/tests"), false);
	// Deny: a src dir at any depth.
	assert.equal(check("src/**", "deny", "/proj/src/a.ts"), true);
	assert.equal(check("src/**", "deny", "/proj/deep/src/a.ts"), true);
	assert.equal(check("src/**", "deny", "/proj/deep/deeper/src/x"), true);
});

test("Edit(**/src/**) matches any depth for every action", () => {
	assert.equal(check("**/src/**", "allow", "/proj/deep/src/a.ts"), true);
	assert.equal(check("**/src/**", "allow", "/proj/src/a.ts"), true);
	assert.equal(check("**/src/**", "deny", "/anywhere/src/x"), true);
	assert.equal(check("**/src/**", "allow", "/proj/a.ts"), false);
});

test("anchors: //, ~/, /, ./", () => {
	assert.equal(check("//tmp/scratch.txt", "allow", "/tmp/scratch.txt"), true);
	assert.equal(check("//tmp/scratch.txt", "allow", "/usr/tmp/scratch.txt"), false);

	assert.equal(check("~/Documents/*.pdf", "allow", "/home/u/Documents/x.pdf"), true);
	assert.equal(check("~/Documents/*.pdf", "allow", "/home/u/Documents/sub/x.pdf"), false); // * = one segment
	assert.equal(check("~/Documents/**", "allow", "/home/u/Documents/sub/x.pdf"), true);
	assert.equal(check("~/Documents/*.pdf", "allow", "/proj/Documents/x.pdf"), false);

	// `/` anchors at the settings source's anchor directory (loader supplies it).
	assert.equal(check("/docs/**", "allow", "/proj/docs/a.md"), true);
	assert.equal(check("/docs/**", "allow", "/other/docs/a.md"), false);

	assert.equal(check("./src/*.ts", "allow", "/proj/src/a.ts"), true);
	assert.equal(check("./src/*.ts", "allow", "/proj/src/a/b.ts"), false);
	assert.equal(check("./src/*.ts", "allow", "/proj/deep/src/a.ts"), false);
});

test("globs: ? and character classes", () => {
	assert.equal(check("???.txt", "deny", "/proj/abc.txt"), true);
	assert.equal(check("???.txt", "deny", "/proj/ab.txt"), false);
	assert.equal(check("???.txt", "deny", "/proj/abcd.txt"), false);
	assert.equal(check("???.txt", "deny", "/proj/deep/abc.txt"), true); // bare name, any depth

	assert.equal(check("logo.[jp]ng", "deny", "/proj/logo.jng"), true);
	assert.equal(check("logo.[jp]ng", "deny", "/proj/logo.png"), true);
	assert.equal(check("logo.[jp]ng", "deny", "/proj/logo.jpg"), false);
});

test("trailing slash = directory form (matches the dir and its contents)", () => {
	assert.equal(check("docs/", "allow", "/proj/docs"), true);
	assert.equal(check("docs/", "allow", "/proj/docs/a.md"), true);
	assert.equal(check("docs/", "allow", "/proj/docs/sub/a.md"), true);
	assert.equal(check("docs/", "allow", "/proj/docsy"), false);
});

test("mid-segment * stays within one segment", () => {
	assert.equal(check("src/*.ts", "allow", "/proj/src/a.ts"), true);
	assert.equal(check("src/*.ts", "allow", "/proj/src/a/b.ts"), false);
	assert.equal(check("*.spec.ts", "deny", "/proj/a.spec.ts"), true);
	assert.equal(check("*.spec.ts", "deny", "/proj/deep/a.spec.ts"), true);
});
