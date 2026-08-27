import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("pi.extensions manifest is a string array pointing at the entrypoint", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  const entries = pkg?.pi?.extensions;
  assert.ok(Array.isArray(entries), "pi.extensions must be an array (object form is silently dropped by pi)");
  for (const entry of entries) {
    assert.equal(typeof entry, "string", `pi.extensions entry must be a string, got: ${typeof entry}`);
  }
  assert.deepEqual(entries, ["./index.ts"]);
});
