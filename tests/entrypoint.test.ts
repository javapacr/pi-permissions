import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../index.ts";

test("entrypoint default-exports an extension factory function", () => {
  assert.equal(typeof extension, "function");
});

test("factory runs against a stub pi without reading real config (FS2 rewiring smoke)", async () => {
  // The factory performs no file I/O at load time (rules load at
  // session_start), but keep HOME redirected for hermeticity anyway.
  // PI_SUBAGENT_CHILD is explicitly deleted: this process may itself be a
  // subagent child, and the child baseline skips UI registrations.
  const fakeHome = mkdtempSync(join(tmpdir(), "piperm-factory-home-"));
  const previousHome = process.env.HOME;
  const previousChild = process.env.PI_SUBAGENT_CHILD;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.HOME = fakeHome;
  delete process.env.PI_SUBAGENT_CHILD;
  delete process.env.PI_CODING_AGENT_DIR;
  const previousCwd = process.cwd();
  try {
    const registrations: { flags: string[]; commands: string[]; shortcuts: string[]; events: string[] } = {
      flags: [], commands: [], shortcuts: [], events: [],
    };
    const stubPi = {
      registerFlag: (name: string) => registrations.flags.push(name),
      getFlag: (_name: string) => undefined,
      registerCommand: (name: string) => registrations.commands.push(name),
      registerShortcut: (keys: string) => registrations.shortcuts.push(keys),
      on: (event: string) => registrations.events.push(event),
    };
    await extension(stubPi as never);
    assert.deepEqual(registrations.flags, ["permission-mode", "dangerously-skip-permissions"]);
    assert.ok(registrations.commands.includes("permissions"));
    assert.ok(registrations.shortcuts.includes("shift+tab"));
    assert.deepEqual(registrations.events.sort(), ["before_agent_start", "session_start", "tool_call"]);
  } finally {
    if (previousCwd !== process.cwd()) process.chdir(previousCwd);
    process.env.HOME = previousHome;
    if (previousAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousChild !== undefined) process.env.PI_SUBAGENT_CHILD = previousChild;
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
