/**
 * FS4 acceptance — parent-side Agent(name) spawn gating + mode-snapshot
 * injection into `subagent` tool calls (input.extensionBindings, the
 * Step-0-verified channel), including per-agent overrides resolved on the
 * parent side and injection hygiene (foreign namespaces preserved, our
 * namespace never model-controllable).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { BINDINGS_NAMESPACE } from "../child.ts";
import { withHarness } from "./harness.ts";

const spawn = (agent?: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...(agent !== undefined ? { agent } : {}),
  task: "do the thing",
  ...extra,
});

test("AGENT deny rule blocks the spawn with rule + source; no binding injected", async () => {
  await withHarness({
    projectConfig: { permissions: { deny: ["Agent(worker)"] } },
  }, async (h) => {
    await h.sessionStart(); // bypass default
    const input = spawn("worker");
    const verdict = await h.toolCall("subagent", input);
    assert.equal(verdict?.block, true);
    assert.match(verdict!.reason, /Denied by rule Agent\(worker\)/);
    assert.equal(input.extensionBindings, undefined, "blocked spawn carries no injection");
    assert.equal(h.dialogs.length, 0);
  });
});

test("AGENT bare `Agent` deny rule = whole-tool: blocks every spawn, named or not", async () => {
  await withHarness({
    projectConfig: { permissions: { deny: ["Agent"] } },
  }, async (h) => {
    await h.sessionStart();
    assert.equal((await h.toolCall("subagent", spawn())).block, true, "bare Agent deny = any agent");
    assert.equal((await h.toolCall("subagent", spawn("scout"))).block, true, "named spawn denied too (whole-tool)");
    assert.match((await h.toolCall("subagent", spawn("worker")))!.reason, /Denied by rule Agent/);
  });
});

test("AGENT ask rule prompts in the parent (UI present); Allow frees + injects, Deny blocks", async () => {
  await withHarness({
    projectConfig: { permissions: { ask: ["Agent(worker)"] } },
  }, async (h) => {
    await h.sessionStart();
    h.choices.push("Allow now");
    const input = spawn("worker");
    assert.equal(await h.toolCall("subagent", input), undefined);
    assert.equal(h.dialogs.length, 1);
    assert.match(h.dialogs[0]!.title, /Agent\(worker\)/);
    assert.deepEqual(input.extensionBindings, { [BINDINGS_NAMESPACE]: { mode: "bypassPermissions" } });

    h.choices.push("Deny");
    const deniedInput = spawn("worker");
    assert.equal((await h.toolCall("subagent", deniedInput)).block, true);
    assert.equal(deniedInput.extensionBindings, undefined, "denied ask injects nothing");
  });
});

test("AGENT allow rule frees the spawn and injects the parent's CURRENT mode (default parent: allow consulted)", async () => {
  await withHarness({
    flags: { "permission-mode": "default" },
    projectConfig: { permissions: { allow: ["Agent(worker)"] } },
  }, async (h) => {
    await h.sessionStart();
    const input = spawn("worker");
    assert.equal(await h.toolCall("subagent", input), undefined);
    assert.equal(h.dialogs.length, 0, "allow rule consulted in default — no prompt");
    assert.deepEqual(input.extensionBindings, { [BINDINGS_NAMESPACE]: { mode: "default" } });
  });
});

test("AGENT PS parent ignores the allow rule (FS2 ignoreAllow) → baseline prompts", async () => {
  await withHarness({
    flags: { "permission-mode": "production-support" },
    projectConfig: { permissions: { allow: ["Agent(worker)"] } },
  }, async (h) => {
    await h.sessionStart();
    h.choices.push("Deny");
    const input = spawn("worker");
    assert.equal((await h.toolCall("subagent", input)).block, true);
    assert.equal(h.dialogs.length, 1);
    assert.equal(input.extensionBindings, undefined);
  });
});

test("AGENT bypass parent, no rule: spawn passes silently with bypass binding", async () => {
  await withHarness({}, async (h) => {
    await h.sessionStart();
    const input = spawn("worker");
    assert.equal(await h.toolCall("subagent", input), undefined);
    assert.deepEqual(input.extensionBindings, { [BINDINGS_NAMESPACE]: { mode: "bypassPermissions" } });
    assert.equal(h.dialogs.length, 0);
  });
});

test("AGENT default parent, no rule: baseline prompts; approve injects default", async () => {
  await withHarness({ flags: { "permission-mode": "default" } }, async (h) => {
    await h.sessionStart();
    h.choices.push("Allow now");
    const input = spawn("worker");
    assert.equal(await h.toolCall("subagent", input), undefined);
    assert.equal(h.dialogs.length, 1);
    assert.match(h.dialogs[0]!.title, /Agent\(worker\)/);
    assert.deepEqual(input.extensionBindings, { [BINDINGS_NAMESPACE]: { mode: "default" } });
  });
});

test("AGENT headless default parent: unmatched spawn fail-closes (existing headless path, no injection)", async () => {
  await withHarness({ flags: { "permission-mode": "default" } }, async (h) => {
    await h.sessionStart();
    const input = spawn("worker");
    const verdict = await h.toolCall("subagent", input, false);
    assert.equal(verdict?.block, true);
    assert.match(verdict!.reason, /no UI available to ask/);
    assert.equal(input.extensionBindings, undefined);
  });
});

test("AGENT production-support parent: spawn prompts (all non-free prompt)", async () => {
  await withHarness({ flags: { "permission-mode": "production-support" } }, async (h) => {
    await h.sessionStart();
    h.choices.push("Allow now");
    const input = spawn("worker");
    assert.equal(await h.toolCall("subagent", input), undefined);
    assert.equal(h.dialogs.length, 1);
    assert.deepEqual(input.extensionBindings, { [BINDINGS_NAMESPACE]: { mode: "production-support" } });
  });
});

test("INJECTION preserves foreign namespaces; overwrites our own (model cannot pre-grant a mode)", async () => {
  await withHarness({}, async (h) => {
    await h.sessionStart();
    const input = spawn("worker", {
      extensionBindings: {
        "other-ext/1": { pinned: true },
        [BINDINGS_NAMESPACE]: { mode: "bypassPermissions" }, // self-grant attempt
      },
    });
    assert.equal(await h.toolCall("subagent", input), undefined);
    assert.deepEqual(input.extensionBindings, {
      "other-ext/1": { pinned: true },
      [BINDINGS_NAMESPACE]: { mode: "bypassPermissions" }, // parent IS in bypass here — equal by coincidence; assert identity below
    });
    // Non-coincidence proof: in default mode the pre-set bypass must NOT survive
  });
  await withHarness({ flags: { "permission-mode": "default" } }, async (h) => {
    await h.sessionStart();
    h.choices.push("Allow now");
    const input = spawn("worker", {
      extensionBindings: { "other-ext/1": { pinned: true }, [BINDINGS_NAMESPACE]: { mode: "bypassPermissions" } },
    });
    assert.equal(await h.toolCall("subagent", input), undefined);
    assert.deepEqual(input.extensionBindings, {
      "other-ext/1": { pinned: true },
      [BINDINGS_NAMESPACE]: { mode: "default" }, // parent's real mode overwrote the model's self-grant
    });
  });
});

test("INJECTION skips non-agent families: bash call input untouched", async () => {
  await withHarness({}, async (h) => {
    await h.sessionStart();
    const input = { command: "echo hi" };
    assert.equal(await h.toolCall("bash", input), undefined);
    assert.equal("extensionBindings" in input, false);
  });
});

test("AGENT per-agent override resolved parent-side: config agentModes worker→bypass under a default parent", async () => {
  await withHarness({
    flags: { "permission-mode": "default" },
    projectConfig: { children: { agentModes: { worker: "bypassPermissions" } } },
  }, async (h) => {
    await h.sessionStart();
    h.choices.push("Allow now"); // default parent still prompts for the spawn itself
    const input = spawn("worker");
    assert.equal(await h.toolCall("subagent", input), undefined);
    assert.deepEqual(input.extensionBindings, { [BINDINGS_NAMESPACE]: { mode: "bypassPermissions" } }, "child gets the override, not the parent mode");
  });
});

test("AGENT frontmatter permissionMode resolved parent-side (project .pi/agents)", async () => {
  await withHarness({
    flags: { "permission-mode": "default" },
  }, async (h) => {
    h.writeAgentDef("worker.md", { name: "worker", permissionMode: "acceptEdits" });
    await h.sessionStart();
    h.choices.push("Allow now");
    const input = spawn("worker");
    assert.equal(await h.toolCall("subagent", input), undefined);
    assert.deepEqual(input.extensionBindings, { [BINDINGS_NAMESPACE]: { mode: "acceptEdits" } });
  });
});

test("AGENT unnamed spawn inherits the parent mode verbatim (no override lookup)", async () => {
  await withHarness({ flags: { "permission-mode": "acceptEdits" } }, async (h) => {
    await h.sessionStart();
    h.choices.push("Allow now");
    const input = spawn();
    assert.equal(await h.toolCall("subagent", input), undefined);
    assert.deepEqual(input.extensionBindings, { [BINDINGS_NAMESPACE]: { mode: "acceptEdits" } });
  });
});

test("AGENT deny beats allow (first-match discipline holds for spawns)", async () => {
  await withHarness({
    projectConfig: { permissions: { deny: ["Agent(worker)"], allow: ["Agent(*)", "Agent"] } },
  }, async (h) => {
    await h.sessionStart();
    assert.equal((await h.toolCall("subagent", spawn("worker"))).block, true);
    assert.equal(await h.toolCall("subagent", spawn("scout")), undefined);
  });
});

// ---------------------------------------------------------------------------
// R3 (review window): children propagate their effective mode to grandchildren
// — every child-branch ALLOW exit injects via the same channel; blocked/fail-
// closed exits never inject. (Before: children spawned grandchildren with a
// model-written or absent binding → fail-open bypass floor.)
// ---------------------------------------------------------------------------

const binding = (mode: string) =>
  JSON.stringify({ "pi-permissions/1": { mode } });

type Bindings = Record<string, { mode?: string } | undefined>;

const ns = (input: Record<string, unknown>): { mode?: string } | undefined =>
  ((input.extensionBindings as Bindings | undefined)?.[BINDINGS_NAMESPACE]);

test("R3: bypass CHILD spawns grandchild → binding carries the child's effective mode", async () => {
  await withHarness({
    child: true,
    env: { PI_SUBAGENT_EXTENSION_BINDINGS: binding("bypassPermissions") },
  }, async (h) => {
    await h.sessionStart();
    const input = spawn("worker");
    const verdict = await h.toolCall("subagent", input);
    assert.equal(verdict, undefined, "bypass child allows the spawn");
    assert.equal(ns(input)?.mode, "bypassPermissions",
      "grandchild inherits the child's effective mode, not a model-written/absent binding");
  });
});

test("R3: default CHILD + Agent allow rule → injection resolves override > child mode", async () => {
  await withHarness({
    child: true,
    env: { PI_SUBAGENT_EXTENSION_BINDINGS: binding("default") },
    projectConfig: {
      permissions: { allow: ["Agent(worker)"] },
      children: { agentModes: { worker: "production-support" } },
    },
  }, async (h) => {
    await h.sessionStart();
    const input = spawn("worker");
    const verdict = await h.toolCall("subagent", input);
    assert.equal(verdict, undefined, "Agent allow rule frees the spawn in a default child");
    assert.equal(ns(input)?.mode, "production-support",
      "grandchild gets the agentModes override, beating the child's default mode");
    // Foreign namespaces the model wrote are still preserved untouched.
    const foreign = spawn("worker", { extensionBindings: { "other/1": { x: 1 }, [BINDINGS_NAMESPACE]: { mode: "bypassPermissions" } } });
    await h.toolCall("subagent", foreign);
    assert.deepEqual((foreign.extensionBindings as Bindings)["other/1"], { x: 1 });
    assert.equal(ns(foreign)?.mode, "production-support",
      "the model's self-granted namespace is overwritten even in a child");
  });
});

test("R3: child fail-closed spawn (acceptEdits baseline) blocks and injects nothing", async () => {
  await withHarness({
    child: true,
    env: { PI_SUBAGENT_EXTENSION_BINDINGS: binding("acceptEdits") },
  }, async (h) => {
    await h.sessionStart();
    const input = spawn("worker");
    const verdict = await h.toolCall("subagent", input);
    assert.equal(verdict?.block, true, "subagent is not Edit/Write/free — acceptEdits child fail-closes");
    assert.match(verdict!.reason, /subagent sessions cannot prompt/);
    assert.equal(input.extensionBindings, undefined, "no injection on a blocked exit");
  });
});
