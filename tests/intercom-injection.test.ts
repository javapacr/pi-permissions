/**
 * Intercom-turn injection (2026-09-04 finding): pi-core consumes
 * `before_agent_start` custom messages only inside AgentSession.prompt();
 * pi-intercom idle delivery enters through sendCustomMessage(triggerTurn) →
 * _runAgentPrompt, which never emits before_agent_start — so the
 * production-support entry/exit framing was silently absent on intercom
 * turns. The turn_start (turnIndex 0) handler delivers the pending framing
 * via pi.sendMessage (steers into the already-running loop; no options —
 * steer is the in-run default). One shared flag consumer in index.ts makes
 * the two paths mutually exclusive.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { BINDINGS_NAMESPACE } from "../child.ts";
import { withHarness } from "./harness.ts";

const psFlag = { "permission-mode": "production-support" };
const inheritedPsBinding = JSON.stringify({ [BINDINGS_NAMESPACE]: { mode: "production-support" } });

test("turn_start(0) delivers the pending PS entry framing via sendMessage (intercom path)", async () => {
  await withHarness({ flags: psFlag }, async (h) => {
    await h.sessionStart();
    assert.equal(h.sentMessages.length, 0, "nothing injected at session start");

    await h.turnStart(0);
    assert.equal(h.sentMessages.length, 1);
    assert.equal(h.sentMessages[0]!.message.customType, "production-support-context");
    assert.match(h.sentMessages[0]!.message.content as string, /report findings before acting/i);
    assert.equal(h.sentMessages[0]!.message.display, true);
    assert.equal(h.sentMessages[0]!.options, undefined, "no deliverAs — in-run default is steer");

    // One-shot: the next turn gets nothing.
    await h.turnStart(0);
    assert.equal(h.sentMessages.length, 1, "injection is one-shot");
  });
});

test("prompt-path parity: before_agent_start consumes the flag — turn_start must not double-inject", async () => {
  await withHarness({ flags: psFlag }, async (h) => {
    await h.sessionStart();
    const injected = await h.beforeAgentStart();
    assert.equal(injected?.message?.customType, "production-support-context");
    await h.turnStart(0);
    assert.equal(h.sentMessages.length, 0, "turn_start stays silent once before_agent_start consumed the flag");
  });
});

test("turn_start with turnIndex > 0 never injects — the flag survives for the next run's first turn", async () => {
  await withHarness({ flags: psFlag }, async (h) => {
    await h.sessionStart();
    await h.turnStart(1);
    assert.equal(h.sentMessages.length, 0);
    await h.turnStart(0);
    assert.equal(h.sentMessages.length, 1, "next run's turn 0 delivers the pending framing");
  });
});

test("PS-ended framing rides turn_start(0) symmetrically after leaving production-support", async () => {
  await withHarness({ flags: psFlag }, async (h) => {
    await h.sessionStart();
    await h.turnStart(0); // entry framing
    await h.cycleMode(); // production-support → bypassPermissions
    await h.turnStart(0);
    assert.equal(h.sentMessages.length, 2);
    assert.equal(h.sentMessages[1]!.message.customType, "production-support-ended-context");
    assert.match(h.sentMessages[1]!.message.content as string, /PRODUCTION SUPPORT MODE ENDED/);
    await h.turnStart(0);
    assert.equal(h.sentMessages.length, 2, "one-shot");
  });
});

test("child mode never injects (flags never arm, even under inherited production-support)", async () => {
  await withHarness(
    { child: true, env: { PI_SUBAGENT_EXTENSION_BINDINGS: inheritedPsBinding } },
    async (h) => {
      await h.sessionStart();
      await h.turnStart(0);
      assert.equal(h.sentMessages.length, 0);
      assert.equal(await h.beforeAgentStart(), undefined);
    },
  );
});
