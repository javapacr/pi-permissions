/**
 * FS2 acceptance: the mode×rule composition matrix (deny > ask > mode
 * baseline > allow), cycle order, flags, production-support specifics, child
 * baseline, and the safety floor's mode-independence — all driven through
 * the REAL factory via tests/harness.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { withHarness } from "./harness.ts";

const bash = (command: string) => ({ command });

test("MATRIX bypass | no rule | unmatched bash passes silently (D4 default)", async () => {
  await withHarness({}, async (h) => {
    await h.sessionStart();
    assert.equal(h.statuses.at(-1)?.text, "⏵⏵⏵⏵ Bypass Permissions");
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    assert.equal(await h.toolCall("write", { path: `${h.cwd}/x.txt`, content: "x" }), undefined);
    assert.equal(h.dialogs.length, 0);
  });
});

test("MATRIX bypass | deny rule | blocks", async () => {
  await withHarness({ projectConfig: { permissions: { deny: ["Bash(echo *)"] } } }, async (h) => {
    await h.sessionStart();
    const verdict = await h.toolCall("bash", bash("echo hi"));
    assert.equal(verdict?.block, true);
    assert.match(verdict!.reason, /Denied by rule Bash\(echo \*\)/);
    assert.equal(h.dialogs.length, 0);
  });
});

test("MATRIX bypass | ask rule | prompts even in bypass (Claude semantics)", async () => {
  await withHarness({ projectConfig: { permissions: { ask: ["Bash(echo *)"] } } }, async (h) => {
    h.choices.push("Allow once");
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    assert.equal(h.dialogs.length, 1);
    assert.match(h.dialogs[0]!.title, /Bash\(echo hi\)/);
    assert.deepEqual(h.dialogs[0]!.options, [
      "Allow once", "Allow for session", "Always", "Deny", "Deny for session",
    ]);
  });
});

test("MATRIX bypass | ask rule | headless fails closed with instructive reason", async () => {
  await withHarness({ projectConfig: { permissions: { ask: ["Bash(echo *)"] } } }, async (h) => {
    await h.sessionStart();
    const verdict = await h.toolCall("bash", bash("echo hi"), false);
    assert.equal(verdict?.block, true);
    assert.match(verdict!.reason, /Permission required: Bash\(echo hi\) \(mode bypassPermissions, no UI available to ask\)/);
    assert.match(verdict!.reason, /--permission-mode bypassPermissions/);
    assert.equal(h.dialogs.length, 0);
  });
});

test("MATRIX default | no rule | reads free, bash/edit/webfetch prompt", async () => {
  await withHarness({ flags: { "permission-mode": "default" } }, async (h) => {
    h.choices.push("Allow once", "Allow once", "Allow once");
    await h.sessionStart();
    assert.equal(h.statuses.at(-1)?.text, "⏵ Default");

    assert.equal(await h.toolCall("read", { path: `${h.cwd}/a.ts` }), undefined);
    assert.equal(await h.toolCall("grep", { pattern: "x", path: h.cwd }), undefined); // Read-class
    assert.equal(await h.toolCall("todo", { todos: [] }), undefined); // free-by-nature
    assert.equal(h.dialogs.length, 0, "reads + todo must not prompt");

    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    assert.equal(await h.toolCall("edit", { path: `${h.cwd}/a.ts` }), undefined);
    assert.equal(await h.toolCall("web_fetch", { url: "https://example.com/x" }), undefined);
    assert.equal(h.dialogs.length, 3);
    assert.match(h.dialogs[2]!.title, /WebFetch\(domain:example\.com\)/);
  });
});

test("MATRIX default | allow rule | consult: allow passes without prompt", async () => {
  await withHarness({
    flags: { "permission-mode": "default" },
    projectConfig: { permissions: { allow: ["Bash(echo *)", "Edit(src/**)"] } },
  }, async (h) => {
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
    assert.equal(await h.toolCall("edit", { path: `${h.cwd}/src/a.ts` }), undefined);
    assert.equal(h.dialogs.length, 0);
  });
});

test("MATRIX default | deny + ask | deny beats ask beats baseline", async () => {
  await withHarness({
    flags: { "permission-mode": "default" },
    projectConfig: { permissions: { deny: ["Bash(rm *)"], ask: ["Bash(git push *)"] } },
  }, async (h) => {
    await h.sessionStart();
    const denied = await h.toolCall("bash", bash("rm -rf build"));
    assert.equal(denied?.block, true);
    assert.match(denied!.reason, /Bash\(rm \*\)/);
    assert.equal(h.dialogs.length, 0, "deny blocks without prompting");
  });
});

test("MATRIX acceptEdits | no rule | write/edit auto-allow, rest per default", async () => {
  await withHarness({ flags: { "permission-mode": "acceptEdits" } }, async (h) => {
    h.choices.push("Allow once");
    await h.sessionStart();
    assert.equal(h.statuses.at(-1)?.text, "⏵⏵ Accept Edits");
    assert.equal(await h.toolCall("edit", { path: `${h.cwd}/a.ts` }), undefined);
    assert.equal(await h.toolCall("write", { path: `${h.cwd}/b.ts`, content: "b" }), undefined);
    assert.equal(await h.toolCall("read", { path: `${h.cwd}/a.ts` }), undefined);
    assert.equal(h.dialogs.length, 0, "edits/reads must not prompt");
    assert.equal(await h.toolCall("bash", bash("npm test")), undefined);
    assert.equal(h.dialogs.length, 1);
  });
});

test("MATRIX acceptEdits | deny-edit blocks", async () => {
  await withHarness({
    flags: { "permission-mode": "acceptEdits" },
    projectConfig: { permissions: { deny: ["Edit(src/**)"] } },
  }, async (h) => {
    await h.sessionStart();
    const verdict = await h.toolCall("edit", { path: `${h.cwd}/src/a.ts` });
    assert.equal(verdict?.block, true);
    assert.match(verdict!.reason, /Edit\(src\/\*\*\)/);
    // Reads on the denied path stay free in acceptEdits (Read baseline).
    assert.equal(await h.toolCall("read", { path: `${h.cwd}/src/a.ts` }), undefined);
  });
});

test("MATRIX acceptEdits | ask-edit prompts", async () => {
  await withHarness({
    flags: { "permission-mode": "acceptEdits" },
    projectConfig: { permissions: { ask: ["Edit(src/**)"] } },
  }, async (h) => {
    h.choices.push("Deny");
    await h.sessionStart();
    const verdict = await h.toolCall("edit", { path: `${h.cwd}/src/a.ts` });
    assert.equal(verdict?.block, true);
    assert.match(verdict!.reason, /User denied/);
    assert.match(h.dialogs[0]!.title, /Edit\(/);
  });
});

test("MATRIX acceptEdits | allow for non-edit tools consults", async () => {
  await withHarness({
    flags: { "permission-mode": "acceptEdits" },
    projectConfig: { permissions: { allow: ["Bash(npm *)"] } },
  }, async (h) => {
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("npm test")), undefined);
    assert.equal(h.dialogs.length, 0);
  });
});

test("MATRIX production-support | no rule | reads free, everything else prompts", async () => {
  await withHarness({ flags: { "permission-mode": "production-support" } }, async (h) => {
    h.choices.push("Allow once", "Allow once", "Allow once", "Allow once");
    await h.sessionStart();
    assert.equal(h.statuses.at(-1)?.text, "🛡 Production Support");

    assert.equal(await h.toolCall("read", { path: `${h.cwd}/a.ts` }), undefined);
    assert.equal(await h.toolCall("ls", { path: h.cwd }), undefined); // Read-class
    assert.equal(await h.toolCall("todo", { todos: [] }), undefined); // free-by-nature
    assert.equal(h.dialogs.length, 0, "reads + todo must not prompt");

    assert.equal(await h.toolCall("bash", bash("ls")), undefined); // bash prompts (no safelist)
    assert.equal(await h.toolCall("write", { path: `${h.cwd}/b.ts`, content: "b" }), undefined);
    assert.equal(await h.toolCall("web_fetch", { url: "https://example.com/" }), undefined);
    assert.equal(await h.toolCall("mcp", { server: "atlassian" }), undefined); // MCP gateway call
    assert.equal(h.dialogs.length, 4);
  });
});

test("MATRIX production-support | allow rule | NOT consulted (still prompts)", async () => {
  await withHarness({
    flags: { "permission-mode": "production-support" },
    projectConfig: { permissions: { allow: ["Bash(ls *)", "Edit(src/**)"] } },
  }, async (h) => {
    h.choices.push("Deny", "Deny");
    await h.sessionStart();
    const bashVerdict = await h.toolCall("bash", bash("ls -la"));
    assert.equal(bashVerdict?.block, true);
    assert.match(bashVerdict!.reason, /User denied Bash\(ls -la\)/);
    const editVerdict = await h.toolCall("edit", { path: `${h.cwd}/src/a.ts` });
    assert.equal(editVerdict?.block, true);
    assert.equal(h.dialogs.length, 2, "allow rules must not preempt the prompt");
  });
});

test("MATRIX production-support | readOnlyBash safelist auto-allows (D2)", async () => {
  await withHarness({
    flags: { "permission-mode": "production-support" },
    projectConfig: {
      productionSupport: { readOnlyBash: ["git status *", "Bash(cat *)", "jq"] },
    },
  }, async (h) => {
    h.choices.push("Deny");
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("git status -s")), undefined);
    assert.equal(await h.toolCall("bash", bash("cat src/a.ts")), undefined); // Bash(...) wrapper accepted
    assert.equal(await h.toolCall("bash", bash("jq")), undefined); // exact form
    assert.equal(h.dialogs.length, 0, "safelisted read-only commands run free");
    const verdict = await h.toolCall("bash", bash("git push origin main"));
    assert.equal(verdict?.block, true, "non-safelisted commands still prompt");
    assert.equal(h.dialogs.length, 1);
  });
});

test("MATRIX production-support | deny/ask rules still gate the free set", async () => {
  await withHarness({
    flags: { "permission-mode": "production-support" },
    projectConfig: {
      productionSupport: { readOnlyBash: ["git *"] },
      permissions: { deny: ["Bash(git push *)"], ask: ["Read(.env)"] },
    },
  }, async (h) => {
    h.choices.push("Deny");
    await h.sessionStart();
    const denied = await h.toolCall("bash", bash("git push origin main"));
    assert.equal(denied?.block, true);
    assert.match(denied!.reason, /Bash\(git push \*\)/);
    const askRead = await h.toolCall("read", { path: `${h.cwd}/.env` });
    assert.equal(askRead?.block, true, "ask on a read prompts even in production-support");
    assert.equal(h.dialogs.length, 1);
  });
});

test("CYCLE Shift+Tab order default → acceptEdits → production-support → bypass → default", async () => {
  await withHarness({ flags: { "permission-mode": "default" } }, async (h) => {
    await h.sessionStart();
    assert.equal(h.statuses.at(-1)?.text, "⏵ Default");
    await h.cycleMode();
    assert.equal(h.statuses.at(-1)?.text, "⏵⏵ Accept Edits");
    await h.cycleMode();
    assert.equal(h.statuses.at(-1)?.text, "🛡 Production Support");
    await h.cycleMode();
    assert.equal(h.statuses.at(-1)?.text, "⏵⏵⏵⏵ Bypass Permissions");
    await h.cycleMode();
    assert.equal(h.statuses.at(-1)?.text, "⏵ Default");
  });
});

test("CYCLE entering production-support injects investigation framing on next turn", async () => {
  await withHarness({ flags: { "permission-mode": "default" } }, async (h) => {
    await h.sessionStart();
    assert.equal(await h.beforeAgentStart(), undefined, "no injection before entering PS");
    await h.cycleMode(); // → acceptEdits
    assert.equal(await h.beforeAgentStart(), undefined);
    await h.cycleMode(); // → production-support
    const injected = await h.beforeAgentStart();
    assert.equal(injected?.message?.customType, "production-support-context");
    assert.match(injected?.message?.content, /investigation mode/i);
    assert.equal(injected?.message?.display, true);
    assert.equal(await h.beforeAgentStart(), undefined, "injection is one-shot");
    await h.cycleMode(); // → bypass (leaving PS)
    const ended = await h.beforeAgentStart();
    assert.equal(ended?.message?.customType, "production-support-ended-context");
  });
});

test("PS injection fires when the session starts in production-support", async () => {
  await withHarness({ flags: { "permission-mode": "production-support" } }, async (h) => {
    await h.sessionStart();
    const injected = await h.beforeAgentStart();
    assert.equal(injected?.message?.customType, "production-support-context");
    assert.match(injected?.message?.content, /report findings before acting/i);
    assert.equal(await h.beforeAgentStart(), undefined);
  });
});

test("FLAGS --dangerously-skip-permissions forces bypass over defaultMode config", async () => {
  await withHarness({
    flags: { "dangerously-skip-permissions": true },
    userConfig: { defaultMode: "default" },
  }, async (h) => {
    await h.sessionStart();
    assert.equal(h.statuses.at(-1)?.text, "⏵⏵⏵⏵ Bypass Permissions");
  });
});

test("FLAGS defaultMode config key honored when no flag given", async () => {
  await withHarness({ userConfig: { defaultMode: "acceptEdits" } }, async (h) => {
    h.choices.push("Allow once");
    await h.sessionStart();
    assert.equal(h.statuses.at(-1)?.text, "⏵⏵ Accept Edits");
    assert.equal(await h.toolCall("edit", { path: `${h.cwd}/a.ts` }), undefined);
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined); // prompts (queued allow)
    assert.equal(h.dialogs.length, 1);
  });
});

test("FLAGS invalid --permission-mode warns and falls back (defaultMode, then D4)", async () => {
  await withHarness({
    flags: { "permission-mode": "plan" },
    userConfig: { defaultMode: "default" },
  }, async (h) => {
    await h.sessionStart();
    assert.ok(h.notifications.some((n) => /Unknown --permission-mode "plan"/.test(n.message)));
    assert.equal(h.statuses.at(-1)?.text, "⏵ Default");
  });
});

test("CHILD baseline (PI_SUBAGENT_CHILD=1): deny blocks, ask fails closed, rest auto-allowed, no UI registrations", async () => {
  await withHarness({
    child: true,
    flags: { "permission-mode": "default" }, // must be ignored in child
    userConfig: { defaultMode: "production-support" }, // must be ignored too
    projectConfig: {
      permissions: { deny: ["Bash(echo *)"], ask: ["Bash(cat *)"], allow: ["Bash(ls *)"] },
    },
  }, async (h) => {
    await h.sessionStart();
    assert.equal(h.statuses.length, 0, "no status bar in child");
    assert.deepEqual(h.registrations.shortcuts, []);
    assert.deepEqual(h.registrations.commands, []);

    const denied = await h.toolCall("bash", bash("echo hi"));
    assert.equal(denied?.block, true);
    assert.match(denied!.reason, /Bash\(echo \*\)/);

    const asked = await h.toolCall("bash", bash("cat a.ts"));
    assert.equal(asked?.block, true);
    assert.match(asked!.reason, /subagent sessions cannot prompt/);
    assert.match(asked!.reason, /Surface this request to the parent session/);

    assert.equal(await h.toolCall("bash", bash("ls")), undefined);
    assert.equal(await h.toolCall("write", { path: `${h.cwd}/x.txt`, content: "x" }), undefined, "unmatched auto-allowed");
    assert.equal(await h.toolCall("edit", { path: `${h.cwd}/y.ts` }), undefined);
    assert.equal(h.dialogs.length, 0, "child never prompts");
  });
});

test("SAFETY floor blocks in every mode (bypass included), incl. READ gating", async () => {
  await withHarness({
    projectConfig: { permissions: { deny: [] }, protectedPaths: ["~/secrets"] },
  }, async (h) => {
    await h.sessionStart(); // bypass
    const readVerdict = await h.toolCall("read", { path: `${h.home}/secrets/key.pem` });
    assert.equal(readVerdict?.block, true, "read of a protected path must be gated");
    assert.match(readVerdict!.reason, /Blocked by safety floor/);
    assert.match(readVerdict!.reason, /cannot be overridden/);

    const grepVerdict = await h.toolCall("grep", { pattern: "x", path: `${h.home}/secrets/key.pem` });
    assert.equal(grepVerdict?.block, true, "grep (Read-class) gated too");

    const editVerdict = await h.toolCall("edit", { path: `${h.home}/secrets/key.pem` });
    assert.equal(editVerdict?.block, true);
    assert.match(editVerdict!.reason, /edit of protected path/);

    const bashVerdict = await h.toolCall("bash", bash(`cat ${h.home}/secrets/key.pem`));
    assert.equal(bashVerdict?.block, true, "bash referencing a protected path (absolute)");
    const tildeVerdict = await h.toolCall("bash", bash("cat ~/secrets/key.pem"));
    assert.equal(tildeVerdict?.block, true, "bash referencing a protected path (~ form)");

    assert.equal(await h.toolCall("read", { path: `${h.cwd}/normal.ts` }), undefined);
  });
});

test("SAFETY floor: critical rm -rf + catastrophic patterns block in bypass", async () => {
  await withHarness({}, async (h) => {
    await h.sessionStart();
    const cases = [
      "rm -rf /",
      "rm -rf / --no-preserve-root",
      "sudo rm -rf /usr",
      "rm -rf ~",
      `rm -rf ${h.home}`,
      "sudo mkfs /dev/sda1",
      "dd if=/dev/zero of=/dev/sda",
      ":(){ :|:& };:",
    ];
    for (const command of cases) {
      const verdict = await h.toolCall("bash", bash(command));
      assert.equal(verdict?.block, true, `must block: ${command}`);
      assert.match(verdict!.reason, /Blocked by safety floor/);
    }
    // Project-local rm -rf and ordinary commands stay allowed in bypass.
    assert.equal(await h.toolCall("bash", bash(`rm -rf ${h.cwd}/build`)), undefined);
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
  });
});

test("MCP direct tools: prompt in default with canonical spec, allow rule passes", async () => {
  await withHarness({
    flags: { "permission-mode": "default" },
    mcpConfig: { mcpServers: { mempalace: { directTools: ["mempalace_search"] } } },
  }, async (h) => {
    h.choices.push("Deny");
    await h.sessionStart();
    const verdict = await h.toolCall("mempalace_search", { query: "x" });
    assert.equal(verdict?.block, true);
    // FS1 judgment call 1: canonical = mcp__server__<raw registry name>; the
    // real-world mempalace raw name is itself prefixed, so the canonical form
    // carries it twice (wire: mempalace_mempalace_search).
    assert.match(verdict!.reason, /User denied mcp__mempalace__mempalace_search/);
    assert.match(h.dialogs[0]!.title, /mcp__mempalace__mempalace_search/);
  });
});

test("MCP direct tools: mcp__server__* allow rule passes in default", async () => {
  await withHarness({
    flags: { "permission-mode": "default" },
    mcpConfig: { mcpServers: { mempalace: { directTools: ["mempalace_search"] } } },
    projectConfig: { permissions: { allow: ["mcp__mempalace__*"] } },
  }, async (h) => {
    await h.sessionStart();
    assert.equal(await h.toolCall("mempalace_search", { query: "x" }), undefined);
    assert.equal(h.dialogs.length, 0);
  });
});

test("/permissions dialog applies the selected mode", async () => {
  await withHarness({ flags: { "permission-mode": "default" } }, async (h) => {
    await h.sessionStart();
    h.choices.push("Production Support — Investigation mode: reads + safelisted read-only bash free; everything else prompts");
    await h.permissionsCommand();
    assert.equal(h.statuses.at(-1)?.text, "🛡 Production Support");
    assert.equal((await h.beforeAgentStart())?.message?.customType, "production-support-context");
  });
});
