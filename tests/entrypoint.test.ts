import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../index.ts";

test("entrypoint default-exports an extension factory function", () => {
  assert.equal(typeof extension, "function");
});

test("factory runs against a stub pi without touching real settings (FS1 rewiring smoke)", async () => {
  // Redirect HOME so the legacy zackify reader inside the factory reads an
  // empty temp home, not the real ~/.pi (hermetic smoke for the index→loader
  // module rewiring; jiti/load behavior is proven by the harness probe).
  const fakeHome = mkdtempSync(join(tmpdir(), "piperm-factory-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = fakeHome;
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
      setActiveTools: (_tools: string[]) => undefined,
      getActiveTools: () => ["bash"],
    };
    await extension(stubPi as never);
    assert.deepEqual(registrations.flags, ["permission-mode", "dangerously-skip-permissions"]);
    assert.ok(registrations.commands.includes("permissions"));
    assert.ok(registrations.shortcuts.includes("shift+tab"));
    assert.deepEqual(registrations.events.sort(), ["before_agent_start", "session_start", "tool_call"]);
  } finally {
    if (previousCwd !== process.cwd()) process.chdir(previousCwd);
    process.env.HOME = previousHome;
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
