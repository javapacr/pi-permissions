import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadZackifyCompatConfig } from "../loader.ts";

// The FS0 config reader, moved verbatim into loader.ts. These tests pin its
// precedence semantics (settings > permissions files; local > global) so the
// move is provably behavior-identical until FS2 deletes it.

function makeTmpHome(): { home: string; cwd: string; cleanup: () => void } {
	const home = mkdtempSync(join(tmpdir(), "piperm-legacy-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "piperm-legacy-cwd-"));
	const write = (dir: string, rel: string, content: unknown) => {
		const path = join(dir, rel);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, JSON.stringify(content));
	};
	return {
		home,
		cwd,
		cleanup: () => {
			rmSync(home, { recursive: true, force: true });
			rmSync(cwd, { recursive: true, force: true });
		},
	};
}

test("legacy reader: defaults when no files exist", async () => {
	const { home, cwd, cleanup } = makeTmpHome();
	try {
		const config = await loadZackifyCompatConfig({ home, cwd });
		assert.equal(config.mode, undefined);
		assert.equal(config.allowCatastrophic, false);
		assert.equal(config.protectedPaths?.length, 15); // DEFAULT_PROTECTED_PATHS
		assert.equal(config.dangerousPatterns?.length, 3);
		assert.equal(config.catastrophicPatterns?.length, 7);
	} finally {
		cleanup();
	}
});

test("legacy reader: precedence — settings keys beat permissions.json, local beats global", async () => {
	const { home, cwd, cleanup } = makeTmpHome();
	const write = (dir: string, rel: string, content: unknown) => {
		const path = join(dir, rel);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, JSON.stringify(content));
	};
	try {
		write(home, ".pi/agent/extensions/permissions.json", {
			defaultMode: "acceptEdits",
			protectedPaths: ["~/global-only"],
		});
		write(home, ".pi/agent/settings.json", {
			piClaudePermissions: { defaultMode: "default", allowCatastrophic: true },
		});
		write(cwd, ".pi/extensions/permissions.json", {
			protectedPaths: ["~/local-wins"],
			planModeAllowedMcpServers: ["mempalace"],
		});
		write(cwd, ".pi/settings.json", {
			piClaudePermissions: { defaultMode: "plan" },
		});

		const config = await loadZackifyCompatConfig({ home, cwd });
		// Settings (piClaudePermissions) beats permissions.json; local beats global.
		assert.equal(config.defaultMode, "plan");
		assert.equal(config.allowCatastrophic, true);
		assert.deepEqual(config.protectedPaths, ["~/local-wins"]);
		assert.deepEqual(config.planModeAllowedMcpServers, ["mempalace"]);
	} finally {
		cleanup();
	}
});
