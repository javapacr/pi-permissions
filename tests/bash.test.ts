import assert from "node:assert/strict";
import { test } from "node:test";
import { matchBashRule } from "../rules/bash.ts";

// Table semantics from the researcher artifact (ccperms.md §3, Bash row).
const cases: Array<[pattern: string, command: string, expected: boolean]> = [
	// `Bash(npm run *)` matches `npm run build`, `npm run test -- --watch`, AND bare `npm run`.
	["npm run *", "npm run build", true],
	["npm run *", "npm run test -- --watch", true],
	["npm run *", "npm run", true],
	["npm run *", "npm runx", false],
	["npm run *", "npm", false],
	// `Bash(ls *)` matches `ls -la` and `ls` but not `lsof`.
	["ls *", "ls -la", true],
	["ls *", "ls", true],
	["ls *", "lsof", false],
	// `Bash(ls*)` matches `lsof` too.
	["ls*", "lsof", true],
	["ls*", "ls", true],
	["ls*", "ls -la", true],
	["ls*", "lsof -la", true],
	// Exact match only.
	["npm run build", "npm run build", true],
	["npm run build", "npm run build --watch", false],
	["npm run build", "npm run buildx", false],
	// `:*` suffix ≡ trailing ` *`.
	["npm run test:*", "npm run test", true],
	["npm run test:*", "npm run test -- --watch", true],
	["npm run test:*", "npm run", false],
	["ls:*", "ls -la", true],
	["ls:*", "lsof", false],
	// Mid-pattern wildcards, anchored both ends.
	["git * main", "git push origin main", true],
	["git * main", "git merge main", true],
	["git * main", "git push origin dev", false],
	// `*` alone = any command.
	["*", "anything at all", true],
	["*", "", true],
	// Leading whitespace is trimmed before matching.
	["npm run *", "  npm run build", true],
	// Escaping: literal metacharacters in globs.
	["grep foo|bar file", "grep foo|bar file", true],
	["grep foo|bar file", "grep foo file", false],
	["echo (hi)", "echo (hi)", true],
];

test("bash glob table (researcher-artifact cases + edges)", () => {
	for (const [pattern, command, expected] of cases) {
		assert.equal(
			matchBashRule(pattern, command),
			expected,
			`matchBashRule(${JSON.stringify(pattern)}, ${JSON.stringify(command)})`,
		);
	}
});

test("PowerShell matching is case-insensitive when requested", () => {
	assert.equal(matchBashRule("Get-ChildItem *", "get-childitem -Recurse", { caseInsensitive: true }), true);
	assert.equal(matchBashRule("Get-ChildItem *", "get-childitem -Recurse"), false);
});
