/**
 * FS3 acceptance: the single ask dialog — each of the 5 choices → correct
 * state change, rule-keyed session cache sharing, scoped persistence
 * round-trips (project → .pi/permissions.json, global → <agentDir>/
 * permissions.json, incl. the Write→Edit(//abs) form), headless fail-closed,
 * and dialog risk labeling. Drives the REAL factory via tests/harness.ts.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { persistableSpec } from "../ask.ts";
import { withHarness } from "./harness.ts";

const bash = (command: string) => ({ command });
const DEFAULT = { "permission-mode": "default" } as const;

function readProjectAllow(h: { cwd: string }): string[] {
  const file = join(h.cwd, ".pi", "permissions.json");
  assert.ok(existsSync(file), "permissions.json must exist");
  const parsed = JSON.parse(readFileSync(file, "utf-8"));
  assert.ok(Array.isArray(parsed.permissions?.allow), "permissions.allow array required");
  return parsed.permissions.allow;
}

test("OPTION Allow now: passes this call only — next identical call prompts again", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    h.choices.push("Allow now", "Deny");
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    const verdict = await h.toolCall("bash", bash("echo hi"));
    assert.equal(verdict?.block, true);
    assert.equal(h.dialogs.length, 2);
  });
});

test("OPTION Allow for this session: subsequent identical call passes without prompting", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    h.choices.push("Allow for this session");
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    assert.equal(h.dialogs.length, 1);
    // A different command still prompts (exact-target key for baseline prompts).
    h.choices.push("Deny");
    const verdict = await h.toolCall("bash", bash("echo bye"));
    assert.equal(verdict?.block, true);
    assert.equal(h.dialogs.length, 2);
  });
});

test("OPTION Allow in project directory: passes, persists to .pi/permissions.json, and the rule reloads next session", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    h.choices.push("Allow in project directory");
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    assert.deepEqual(readProjectAllow(h), ["Bash(echo hi)"]);
    assert.equal(existsSync(join(h.cwd, ".pi", "permissions.json.tmp")), false, "no tmp residue");
    assert.equal(
      existsSync(join(h.cwd, ".pi", "permissions.local.json")),
      false,
      "pi-local is no longer a dialog write target (D5 revised)",
    );

    // Same session: cached, no new dialog.
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    assert.equal(h.dialogs.length, 1);

    // Next session: rule loaded from disk, cache empty — must pass silently.
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    assert.equal(h.dialogs.length, 1, "persisted allow must survive the reload");
  });
});

test("OPTION Allow in global directory: passes, persists to <agentDir>/permissions.json, and the rule reloads next session", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    h.choices.push("Allow in global directory");
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    const file = join(h.agentDir, "permissions.json");
    assert.ok(existsSync(file), "agent-dir permissions.json must exist");
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    assert.deepEqual(parsed.permissions.allow, ["Bash(echo hi)"]);
    assert.equal(
      existsSync(join(h.cwd, ".pi", "permissions.json")),
      false,
      "project scope must not be written by the global option",
    );

    // Next session: rule loaded from the pi-user scope, cache empty — silent pass.
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    assert.equal(h.dialogs.length, 1, "persisted allow must survive the reload");
  });
});

test("OPTION Deny: blocks this call; next call prompts again", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    h.choices.push("Deny", "Allow now");
    await h.sessionStart();
    const verdict = await h.toolCall("bash", bash("echo hi"));
    assert.equal(verdict?.block, true);
    assert.match(verdict!.reason, /User denied Bash\(echo hi\)/);
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    assert.equal(h.dialogs.length, 2);
  });
});

test("OPTION esc/unknown → deny-once (conservative default)", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    h.choices.push("esc"); // harness returns unknown strings verbatim → default branch
    await h.sessionStart();
    const verdict = await h.toolCall("bash", bash("echo hi"));
    assert.equal(verdict?.block, true);
    assert.match(verdict!.reason, /User denied/);
    h.choices.push("Allow now");
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
  });
});

test("CACHE rule-keyed: Bash(git push *) approval shares across inputs (not input-keyed)", async () => {
  await withHarness({
    projectConfig: { permissions: { ask: ["Bash(git push *)"] } },
  }, async (h) => {
    h.choices.push("Allow for this session");
    await h.sessionStart(); // bypass default; ask prompts even in bypass
    assert.equal(await h.toolCall("bash", bash("git push origin main")), undefined);
    assert.equal(await h.toolCall("bash", bash("git push origin dev")), undefined);
    assert.equal(h.dialogs.length, 1, "one approval covers every input under the rule");
    // Unmatched commands: bypass baseline auto-allows (no prompt) — the
    // approval never leaks outside the rule's inputs because the cache key
    // is the rule spec, not the command.
    assert.equal(await h.toolCall("bash", bash("git status")), undefined);
    assert.equal(h.dialogs.length, 1);
  });
});

test("CACHE rule-keyed contrast: 'Allow now' does NOT share across inputs", async () => {
  await withHarness({
    projectConfig: { permissions: { ask: ["Bash(git push *)"] } },
  }, async (h) => {
    h.choices.push("Allow now", "Deny");
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("git push origin main")), undefined);
    const verdict = await h.toolCall("bash", bash("git push origin dev"));
    assert.equal(verdict?.block, true);
    assert.equal(h.dialogs.length, 2);
  });
});

test("CACHE session cache clears on mode change", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    h.choices.push("Allow for this session", "Deny");
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    await h.cycleMode(); // default → acceptEdits
    const verdict = await h.toolCall("bash", bash("echo hi"));
    assert.equal(verdict?.block, true, "session allows must reset on mode change");
    assert.equal(h.dialogs.length, 2);
  });
});

test("HEADLESS default-mode bash fails closed with the instructive reason", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    await h.sessionStart();
    const verdict = await h.toolCall("bash", bash("echo hi"), false);
    assert.equal(verdict?.block, true);
    assert.match(verdict!.reason, /Permission required: Bash\(echo hi\) \(mode default, no UI available to ask\)/);
    assert.match(verdict!.reason, /\{"permissions":\{"allow":\["Bash\(echo hi\)"\]\}\}/);
    assert.match(verdict!.reason, /\.pi\/permissions\.json/);
    assert.match(verdict!.reason, /--permission-mode bypassPermissions/);
    assert.equal(h.dialogs.length, 0);
  });
});

test("HEADLESS write target shows the Edit(//abs) form in the hint", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    await h.sessionStart();
    const verdict = await h.toolCall("write", { path: `${h.cwd}/notes/a.txt`, content: "x" }, false);
    assert.equal(verdict?.block, true);
    assert.match(verdict!.reason, /Write\(\/.*notes\/a\.txt\)/);
    const persistedForm = `Edit(//${h.cwd.replace(/^\/+/, "")}/notes/a.txt)`;
    assert.ok(
      verdict!.reason.includes(JSON.stringify(persistedForm)),
      `hint must show ${persistedForm}`,
    );
  });
});

test("PROJECT write target persists as Edit(//abs) and re-allows writes next session", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    h.choices.push("Allow in project directory");
    await h.sessionStart();
    assert.equal(await h.toolCall("write", { path: `${h.cwd}/notes/a.txt`, content: "x" }), undefined);
    const expected = `Edit(//${h.cwd.replace(/^\/+/, "")}/notes/a.txt)`;
    assert.deepEqual(
      readProjectAllow(h),
      [expected],
      "Write(path) is invalid — Edit governs Write; // anchors at fs root",
    );
    await h.sessionStart(); // reload rules from disk
    assert.equal(await h.toolCall("write", { path: `${h.cwd}/notes/a.txt`, content: "y" }), undefined);
    assert.equal(h.dialogs.length, 1);
  });
});

test("PROJECT unpersistable target (webfetch without hostname) warns, no file, session allow applies", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    h.choices.push("Allow in project directory");
    await h.sessionStart();
    assert.equal(await h.toolCall("web_fetch", { url: "not a url" }), undefined);
    assert.ok(h.notifications.some((n) => /Could not persist an allow rule/.test(n.message)));
    assert.equal(existsSync(join(h.cwd, ".pi", "permissions.json")), false);
    assert.equal(await h.toolCall("web_fetch", { url: "not a url" }), undefined, "cached for session");
  });
});

test("GLOBAL unpersistable target (webfetch without hostname) warns, no file, session allow applies", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    h.choices.push("Allow in global directory");
    await h.sessionStart();
    assert.equal(await h.toolCall("web_fetch", { url: "not a url" }), undefined);
    assert.ok(h.notifications.some((n) => /Could not persist an allow rule/.test(n.message)));
    assert.equal(existsSync(join(h.agentDir, "permissions.json")), false);
    assert.equal(await h.toolCall("web_fetch", { url: "not a url" }), undefined, "cached for session");
  });
});

test("DIALOG bash risk labeling: dangerous command carries ⚠️ annotation", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    h.choices.push("Deny");
    await h.sessionStart();
    const verdict = await h.toolCall("bash", bash("chmod -R 777 /tmp/x"));
    assert.equal(verdict?.block, true, "dangerous (non-catastrophic) still prompts, not floor-blocked");
    assert.match(h.dialogs[0]!.title, /chmod -R 777/);
    assert.match(h.dialogs[0]!.title, /⚠️/);
    assert.match(h.dialogs[0]!.title, /DANGEROUS/);
  });
});

test("DIALOG non-bash targets use the 🔒 icon and canonical spec", async () => {
  await withHarness({ flags: DEFAULT }, async (h) => {
    h.choices.push("Deny");
    await h.sessionStart();
    const verdict = await h.toolCall("web_fetch", { url: "https://api.example.com/x" });
    assert.equal(verdict?.block, true);
    assert.match(h.dialogs[0]!.title, /🔒 WebFetch\(domain:api\.example\.com\)/);
  });
});

// ---------------------------------------------------------------------------
// R4 (review window): whole-gateway `mcp` and unresolved-server fallback
// approvals are session-only — persistence refused (no sound narrower rule).
// ---------------------------------------------------------------------------

test("R4: persistableSpec refuses whole-tool mcp and unresolved fallbacks", () => {
	const C = { home: "/home/u", cwd: "/proj" };
	const whole = { spec: "mcp", family: "other" as const, tool: "mcp", piTool: "mcp" };
	assert.equal(persistableSpec(whole, C), undefined, "whole-gateway mcp must not persist");
	const fallback = { spec: "mcp__mempalace", family: "mcp" as const, tool: "mcp__mempalace", piTool: "mcp", unresolved: true };
	assert.equal(persistableSpec(fallback, C), undefined, "registry-unresolved fallback must not persist");
	// A real (rule-matched or registry-resolved) server-level target still persists.
	const real = { spec: "mcp__mempalace", family: "mcp" as const, tool: "mcp__mempalace", piTool: "mcp" };
	assert.equal(persistableSpec(real, C), "mcp__mempalace");
});
