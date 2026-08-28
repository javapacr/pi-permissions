/**
 * FS4 acceptance — child mode inheritance (D8) + degradation matrix.
 *
 * Unit: binding decode edge cases, override precedence (config agentModes >
 * agent frontmatter permissionMode > inherited snapshot > bypass floor),
 * agent-file matching. Factory: the full inherited-mode × tool matrix via
 * the harness (every prompt-decision path terminates fail-closed, zero
 * dialogs), ask-rule fail-close, allow-rule consultation, readOnlyBash,
 * and per-agent overrides beating the inherited snapshot.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BINDINGS_NAMESPACE,
  frontmatterAgentMode,
  readInheritedMode,
  resolveChildMode,
} from "../child.ts";
import { withHarness, type Harness } from "./harness.ts";

const bash = (command: string) => ({ command });
const binding = (mode: string) => JSON.stringify({ [BINDINGS_NAMESPACE]: { mode } });

const ALL_MODES = ["default", "acceptEdits", "production-support", "bypassPermissions"] as const;

// ---------------------------------------------------------------- unit

test("readInheritedMode: valid binding decodes", () => {
  assert.equal(readInheritedMode({ PI_SUBAGENT_EXTENSION_BINDINGS: binding("production-support") }), "production-support");
});

test("readInheritedMode: missing / garbage / wrong-namespace / invalid mode → undefined", () => {
  assert.equal(readInheritedMode({}), undefined);
  assert.equal(readInheritedMode({ PI_SUBAGENT_EXTENSION_BINDINGS: "not json{" }), undefined);
  assert.equal(readInheritedMode({ PI_SUBAGENT_EXTENSION_BINDINGS: JSON.stringify({ "other/1": { mode: "default" } }) }), undefined);
  assert.equal(readInheritedMode({ PI_SUBAGENT_EXTENSION_BINDINGS: binding("plan") }), undefined);
  assert.equal(readInheritedMode({ PI_SUBAGENT_EXTENSION_BINDINGS: binding("") }), undefined);
});

test("resolveChildMode: no agent, no binding → bypass floor; binding survives", () => {
  const base = { agentName: undefined, cwd: "/nonexistent-fs4", home: "/nonexistent-fs4", agentDir: "/nonexistent-fs4" };
  assert.equal(resolveChildMode({ ...base }), "bypassPermissions");
  assert.equal(resolveChildMode({ ...base, inherited: "default" }), "default");
});

test("resolveChildMode: config agentModes beats frontmatter beats inherited", () => {
  const dirA = mkdtempSync(join(tmpdir(), "piperm-ag-"));
  const dirB = mkdtempSync(join(tmpdir(), "piperm-ag-"));
  try {
    writeFileSync(join(dirA, "worker.md"), `---\nname: worker\npermissionMode: acceptEdits\n---\n`);
    writeFileSync(join(dirB, "worker.md"), `---\nname: worker\npermissionMode: default\n---\n`);
    const base = { agentName: "worker", cwd: "/nonexistent-fs4", home: "/nonexistent-fs4", agentDir: "/nonexistent-fs4", extraDirs: [dirA, dirB] };
    assert.equal(resolveChildMode({ ...base, inherited: "production-support" }), "acceptEdits", "frontmatter beats inherited");
    assert.equal(
      resolveChildMode({ ...base, children: { agentModes: { worker: "bypassPermissions" } }, inherited: "production-support" }),
      "bypassPermissions",
      "config beats frontmatter + inherited",
    );
    assert.equal(
      resolveChildMode({ ...base, children: { agentModes: { other: "default" } }, inherited: "production-support" }),
      "acceptEdits",
      "unrelated config entry does not apply",
    );
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test("frontmatterAgentMode: shadowed lower-precedence definition cannot leak its mode (first MATCH terminates)", () => {
  const dirX = mkdtempSync(join(tmpdir(), "piperm-ag-"));
  const dirY = mkdtempSync(join(tmpdir(), "piperm-ag-"));
  try {
    writeFileSync(join(dirX, "worker.md"), `---\nname: worker\ndescription: project-local worker, no permission mode\n---\n`);
    writeFileSync(join(dirY, "worker.md"), `---\nname: worker\ndescription: user-level worker\npermissionMode: default\n---\n`);
    const base = { cwd: "/nonexistent-fs4", home: "/nonexistent-fs4", agentDir: "/nonexistent-fs4" };
    assert.equal(
      frontmatterAgentMode({ ...base, agentName: "worker", extraDirs: [dirX, dirY] }),
      undefined,
      "project match without a mode shadows the user definition (pi-subagents name resolution)",
    );
    // control: reversed order → the user-level mode DOES apply
    assert.equal(frontmatterAgentMode({ ...base, agentName: "worker", extraDirs: [dirY, dirX] }), "default");
  } finally {
    rmSync(dirX, { recursive: true, force: true });
    rmSync(dirY, { recursive: true, force: true });
  }
});

test("frontmatterAgentMode: YAML-quoted permissionMode values parse", () => {
  const dir = mkdtempSync(join(tmpdir(), "piperm-ag-"));
  try {
    writeFileSync(join(dir, "worker.md"), `---\nname: worker\npermissionMode: "acceptEdits"\n---\n`);
    const base = { cwd: "/nonexistent-fs4", home: "/nonexistent-fs4", agentDir: "/nonexistent-fs4" };
    assert.equal(frontmatterAgentMode({ ...base, agentName: "worker", extraDirs: [dir] }), "acceptEdits");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("frontmatterAgentMode: filename, frontmatter name, and alias matching; invalid values ignored; first dir wins", () => {
  const dirA = mkdtempSync(join(tmpdir(), "piperm-ag-"));
  const dirB = mkdtempSync(join(tmpdir(), "piperm-ag-"));
  try {
    writeFileSync(join(dirA, "impl.md"), `---\nname: builder\naliases: worker, coder\npermissionMode: production-support\n---\n`);
    writeFileSync(join(dirA, "broken.md"), `---\nname: broken\npermissionMode: not-a-mode\n---\n`);
    writeFileSync(join(dirB, "builder.md"), `---\nname: builder\npermissionMode: default\n---\n`);
    const base = { cwd: "/nonexistent-fs4", home: "/nonexistent-fs4", agentDir: "/nonexistent-fs4" };
    assert.equal(frontmatterAgentMode({ ...base, agentName: "impl", extraDirs: [dirA] }), "production-support", "filename-stem match (impl.md)");
    assert.equal(frontmatterAgentMode({ ...base, agentName: "ghost", extraDirs: [dirA] }), undefined, "absent agent → no match anywhere");
    assert.equal(frontmatterAgentMode({ ...base, agentName: "builder", extraDirs: [dirA] }), "production-support", "frontmatter name match");
    assert.equal(frontmatterAgentMode({ ...base, agentName: "worker", extraDirs: [dirA] }), "production-support", "alias match");
    assert.equal(frontmatterAgentMode({ ...base, agentName: "coder", extraDirs: [dirA] }), "production-support", "second alias match");
    assert.equal(frontmatterAgentMode({ ...base, agentName: "broken", extraDirs: [dirA] }), undefined, "invalid mode value ignored");
    assert.equal(frontmatterAgentMode({ ...base, agentName: "builder", extraDirs: [dirA, dirB] }), "production-support", "first dir wins over later");
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- factory: matrix

/** All prompt-decision paths must terminate fail-closed — never a dialog. */
async function childMatrixCall(h: Harness, mode: string, toolName: string, input: Record<string, unknown>, hasUI: boolean) {
  const verdict = await h.toolCall(toolName, input, hasUI);
  assert.equal(h.dialogs.length, 0, `child must never open a dialog (${mode} × ${toolName})`);
  return verdict;
}

test("CHILD matrix: inherited bypass ≡ rules-on-bypass floor (all pass, minus rules)", async () => {
  await withHarness({
    child: true,
    env: { PI_SUBAGENT_EXTENSION_BINDINGS: binding("bypassPermissions") },
    projectConfig: { permissions: { deny: ["Bash(echo *)"] } },
  }, async (h) => {
    await h.sessionStart();
    for (const hasUI of [true, false]) {
      assert.equal(await childMatrixCall(h, "bypass", "bash", bash("curl x"), hasUI), undefined);
      assert.equal(await childMatrixCall(h, "bypass", "write", { path: `${h.cwd}/x.txt`, content: "x" }, hasUI), undefined);
      assert.equal(await childMatrixCall(h, "bypass", "edit", { path: `${h.cwd}/y.ts` }, hasUI), undefined);
      assert.equal(await childMatrixCall(h, "bypass", "mcp", { action: "status" }, hasUI), undefined);
    }
    const denied = await h.toolCall("bash", bash("echo hi"));
    assert.equal(denied?.block, true, "deny rule still binds in a bypass child");
    assert.match(denied!.reason, /Denied by rule Bash\(echo \*\)/);
  });
});

test("CHILD matrix: inherited default — every prompt decision fail-closes with surface-to-parent reason", async () => {
  await withHarness({
    child: true,
    env: { PI_SUBAGENT_EXTENSION_BINDINGS: binding("default") },
  }, async (h) => {
    await h.sessionStart();
    for (const hasUI of [true, false]) {
      const bashVerdict = await childMatrixCall(h, "default", "bash", bash("curl x"), hasUI);
      assert.equal(bashVerdict?.block, true);
      assert.match(bashVerdict!.reason, /Blocked by child permission policy: Bash\(curl x\)/);
      assert.match(bashVerdict!.reason, /Default mode/);
      assert.match(bashVerdict!.reason, /Surface this request to the parent session/);

      const writeVerdict = await childMatrixCall(h, "default", "write", { path: `${h.cwd}/x.txt`, content: "x" }, hasUI);
      assert.equal(writeVerdict?.block, true);

      const editVerdict = await childMatrixCall(h, "default", "edit", { path: `${h.cwd}/y.ts` }, hasUI);
      assert.equal(editVerdict?.block, true);

      const mcpVerdict = await childMatrixCall(h, "default", "mcp", { action: "status" }, hasUI);
      assert.equal(mcpVerdict?.block, true);
    }
    // free set still passes under default
    assert.equal(await h.toolCall("read", { path: `${h.cwd}/a.ts` }), undefined);
    assert.equal(await h.toolCall("todo", { todos: [] }), undefined);
  });
});

test("CHILD matrix: inherited acceptEdits — write/edit pass, bash/mcp fail-close", async () => {
  await withHarness({
    child: true,
    env: { PI_SUBAGENT_EXTENSION_BINDINGS: binding("acceptEdits") },
  }, async (h) => {
    await h.sessionStart();
    assert.equal(await childMatrixCall(h, "acceptEdits", "write", { path: `${h.cwd}/x.txt`, content: "x" }, true), undefined);
    assert.equal(await childMatrixCall(h, "acceptEdits", "edit", { path: `${h.cwd}/y.ts` }, true), undefined);
    for (const tool of [["bash", bash("curl x")], ["mcp", { action: "status" }]] as const) {
      const verdict = await childMatrixCall(h, "acceptEdits", tool[0], tool[1], true);
      assert.equal(verdict?.block, true, `${tool[0]} must fail-close under acceptEdits child`);
    }
  });
});

test("CHILD matrix: inherited production-support — bash fail-closes w/ PS framing; readOnlyBash frees; reads free", async () => {
  await withHarness({
    child: true,
    env: { PI_SUBAGENT_EXTENSION_BINDINGS: binding("production-support") },
    projectConfig: { productionSupport: { readOnlyBash: ["Bash(git status)"] } },
  }, async (h) => {
    await h.sessionStart();
    const verdict = await childMatrixCall(h, "production-support", "bash", bash("touch /tmp/x"), true);
    assert.equal(verdict?.block, true);
    assert.match(verdict!.reason, /Production Support/);
    assert.match(verdict!.reason, /Surface this request to the parent session/);
    assert.equal(await childMatrixCall(h, "production-support", "bash", bash("git status"), true), undefined, "readOnlyBash frees");
    assert.equal(await childMatrixCall(h, "production-support", "read", { path: `${h.cwd}/a.ts` }, true), undefined, "reads free");
    assert.equal((await childMatrixCall(h, "production-support", "write", { path: `${h.cwd}/x.txt`, content: "x" }, true))?.block, true);
  });
});

test("CHILD matrix: PS ignores allow rules; default consults them", async () => {
  await withHarness({
    child: true,
    env: { PI_SUBAGENT_EXTENSION_BINDINGS: binding("production-support") },
    projectConfig: { permissions: { allow: ["Bash(curl *)"] } },
  }, async (h) => {
    await h.sessionStart();
    assert.equal((await h.toolCall("bash", bash("curl x"))).block, true, "PS child never consults allow");
  });
  await withHarness({
    child: true,
    env: { PI_SUBAGENT_EXTENSION_BINDINGS: binding("default") },
    projectConfig: { permissions: { allow: ["Bash(curl *)"] } },
  }, async (h) => {
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("curl x")), undefined, "default child honors allow");
  });
});

test("CHILD: ask rule fail-closes under EVERY inherited mode with ask reason", async () => {
  for (const mode of ALL_MODES) {
    await withHarness({
      child: true,
      env: { PI_SUBAGENT_EXTENSION_BINDINGS: binding(mode) },
      projectConfig: { permissions: { ask: ["Bash(git push *)"] } },
    }, async (h) => {
      await h.sessionStart();
      const verdict = await childMatrixCall(h, mode, "bash", bash("git push origin main"), true);
      assert.equal(verdict?.block, true, `ask must fail-close in ${mode} child`);
      assert.match(verdict!.reason, /Permission required: Bash\(git push origin main\) \(ask rule Bash\(git push \*\)/);
      assert.match(verdict!.reason, /parent session mode/);
      assert.match(verdict!.reason, /Surface this request to the parent session/);
    });
  }
});

test("CHILD: missing/garbage binding → rules-on-bypass floor (snapshot floor, no dialogs)", async () => {
  for (const raw of [undefined, "garbage{", binding("plan")]) {
    await withHarness({
      child: true,
      env: raw === undefined ? {} : { PI_SUBAGENT_EXTENSION_BINDINGS: raw },
    }, async (h) => {
      await h.sessionStart();
      assert.equal(await h.toolCall("bash", bash("curl x")), undefined);
      assert.equal(await h.toolCall("write", { path: `${h.cwd}/x.txt`, content: "x" }), undefined);
      assert.equal(h.dialogs.length, 0);
    });
  }
});

// ------------------------------------------------- factory: per-agent overrides

test("CHILD: config agentModes override beats inherited snapshot (PS parent → bypass worker)", async () => {
  await withHarness({
    child: true,
    env: {
      PI_SUBAGENT_EXTENSION_BINDINGS: binding("production-support"),
      PI_SUBAGENT_CHILD_AGENT: "worker",
    },
    projectConfig: { children: { agentModes: { worker: "bypassPermissions" } } },
  }, async (h) => {
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("curl x")), undefined, "worker override frees bash despite PS parent");
    assert.equal(h.dialogs.length, 0);
  });
});

test("CHILD: frontmatter permissionMode beats inherited snapshot (default parent → acceptEdits worker)", async () => {
  await withHarness({
    child: true,
    env: {
      PI_SUBAGENT_EXTENSION_BINDINGS: binding("default"),
      PI_SUBAGENT_CHILD_AGENT: "worker",
    },
  }, async (h) => {
    h.writeAgentDef("worker.md", { name: "worker", permissionMode: "acceptEdits" });
    await h.sessionStart();
    assert.equal(await h.toolCall("write", { path: `${h.cwd}/x.txt`, content: "x" }), undefined, "acceptEdits override frees write");
    assert.equal((await h.toolCall("bash", bash("curl x"))).block, true, "bash still fail-closes under acceptEdits override");
  });
});

test("CHILD: config beats frontmatter when both name a mode", async () => {
  await withHarness({
    child: true,
    env: {
      PI_SUBAGENT_EXTENSION_BINDINGS: binding("default"),
      PI_SUBAGENT_CHILD_AGENT: "worker",
    },
    projectConfig: { children: { agentModes: { worker: "production-support" } } },
  }, async (h) => {
    h.writeAgentDef("worker.md", { name: "worker", permissionMode: "acceptEdits" });
    await h.sessionStart();
    assert.equal((await h.toolCall("write", { path: `${h.cwd}/x.txt`, content: "x" })).block, true, "config PS wins: write blocks");
  });
});

test("CHILD: override without inheritance still resolves (no binding, frontmatter only)", async () => {
  await withHarness({
    child: true,
    env: { PI_SUBAGENT_CHILD_AGENT: "worker" },
  }, async (h) => {
    h.writeAgentDef("worker.md", { name: "worker", permissionMode: "default" });
    await h.sessionStart();
    assert.equal((await h.toolCall("bash", bash("curl x"))).block, true, "no binding, override default → fail-close");
  });
});

test("CHILD: deny rule blocks even under per-agent bypass override (rules always enforced)", async () => {
  await withHarness({
    child: true,
    env: { PI_SUBAGENT_CHILD_AGENT: "worker" },
    projectConfig: {
      permissions: { deny: ["Bash(rm -rf *)"] },
      children: { agentModes: { worker: "bypassPermissions" } },
    },
  }, async (h) => {
    await h.sessionStart();
    const verdict = await h.toolCall("bash", bash("rm -rf /tmp/x"));
    assert.equal(verdict?.block, true);
    assert.match(verdict!.reason, /Denied by rule/);
  });
});
