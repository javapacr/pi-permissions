import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILT_IN_MODES,
  DEFAULT_MODE,
  PRODUCTION_SUPPORT_ENDED_MESSAGE,
  PRODUCTION_SUPPORT_MESSAGE,
  SHIFT_TAB_ORDER,
  isValidMode,
  normalizeMode,
} from "../modes.ts";

test("default startup mode is bypassPermissions (D4)", () => {
  assert.equal(DEFAULT_MODE, "bypassPermissions");
});

test("FS2 mode set: the 4 modes, plan deleted (D1), production-support added (D2)", () => {
  assert.deepEqual(
    BUILT_IN_MODES.map((m) => m.id),
    ["default", "acceptEdits", "production-support", "bypassPermissions"],
  );
});

test("production-support carries the 🛡 status icon", () => {
  const ps = BUILT_IN_MODES.find((m) => m.id === "production-support")!;
  assert.equal(ps.status, "🛡");
  assert.equal(ps.label, "Production Support");
});

test("Shift+Tab cycle order: default → acceptEdits → production-support → bypass", () => {
  assert.deepEqual(SHIFT_TAB_ORDER, ["default", "acceptEdits", "production-support", "bypassPermissions"]);
});

test("production-support investigation framing is present (D2)", () => {
  assert.match(PRODUCTION_SUPPORT_MESSAGE, /\[PRODUCTION SUPPORT MODE\]/);
  assert.match(PRODUCTION_SUPPORT_MESSAGE, /no mutations without explicit approval|Do not mutate anything without explicit approval/);
  assert.match(PRODUCTION_SUPPORT_MESSAGE, /read-only/);
  assert.match(PRODUCTION_SUPPORT_MESSAGE, /report findings before acting/i);
  assert.match(PRODUCTION_SUPPORT_MESSAGE, /readOnlyBash/);
  assert.match(PRODUCTION_SUPPORT_ENDED_MESSAGE, /PRODUCTION SUPPORT MODE ENDED/);
});

test("normalizeMode: valid passes through, unknown/absent falls back (incl. plan)", () => {
  assert.equal(normalizeMode("default"), "default");
  assert.equal(normalizeMode("garbage"), DEFAULT_MODE);
  assert.equal(normalizeMode("plan"), DEFAULT_MODE);
  assert.equal(normalizeMode(undefined, "default"), "default");
  assert.equal(isValidMode("production-support"), true);
  assert.equal(isValidMode("plan"), false);
});
