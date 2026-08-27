import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "../index.ts";

test("entrypoint default-exports an extension factory function", () => {
  assert.equal(typeof extension, "function");
});
