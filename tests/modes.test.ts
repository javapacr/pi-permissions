import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_MODES, DEFAULT_MODE, normalizeMode } from "../modes.ts";

test("default startup mode is bypassPermissions (D4)", () => {
  assert.equal(DEFAULT_MODE, "bypassPermissions");
});

test("zackify mode set ported intact — plan mode dormant until FS2 deletes it", () => {
  assert.deepEqual(
    BUILT_IN_MODES.map((m) => m.id),
    ["default", "plan", "acceptEdits", "bypassPermissions"],
  );
});

test("unknown mode falls back to DEFAULT_MODE", () => {
  assert.equal(normalizeMode("garbage"), DEFAULT_MODE);
});
