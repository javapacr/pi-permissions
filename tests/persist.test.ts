/**
 * FS3 acceptance: persistence — correct scope format, dedupe, sibling-key
 * preservation, claude-local target, atomicity (tmp+rename, no residue).
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { persistAllowRule } from "../persist.ts";

function tmpCwd(): { cwd: string; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "piperm-persist-"));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("writes {permissions:{allow:[spec]}} creating the .pi directory", () => {
  const { cwd, cleanup } = tmpCwd();
  try {
    const file = persistAllowRule("Bash(echo hi)", { cwd });
    assert.equal(file, join(cwd, ".pi", "permissions.local.json"));
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    assert.deepEqual(parsed, { permissions: { allow: ["Bash(echo hi)"] } });
    assert.equal(existsSync(`${file}.tmp`), false, "no tmp residue (atomic rename)");
  } finally {
    cleanup();
  }
});

test("dedupes exact-string repeats", () => {
  const { cwd, cleanup } = tmpCwd();
  try {
    const file = persistAllowRule("Bash(echo hi)", { cwd });
    persistAllowRule("Bash(echo hi)", { cwd });
    persistAllowRule("Bash(echo bye)", { cwd });
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    assert.deepEqual(parsed.permissions.allow, ["Bash(echo hi)", "Bash(echo bye)"]);
  } finally {
    cleanup();
  }
});

test("preserves sibling keys (top-level + permissions.deny/ask)", () => {
  const { cwd, cleanup } = tmpCwd();
  try {
    const file = join(cwd, ".pi", "permissions.local.json");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(file, JSON.stringify({
      defaultMode: "acceptEdits",
      permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm *)"], ask: ["Edit(src/**)"] },
    }, null, 2));
    persistAllowRule("Bash(echo hi)", { cwd });
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    assert.equal(parsed.defaultMode, "acceptEdits");
    assert.deepEqual(parsed.permissions.deny, ["Bash(rm *)"]);
    assert.deepEqual(parsed.permissions.ask, ["Edit(src/**)"]);
    assert.deepEqual(parsed.permissions.allow, ["Bash(ls)", "Bash(echo hi)"]);
  } finally {
    cleanup();
  }
});

test("persistTarget 'claude-local' writes .claude/settings.local.json", () => {
  const { cwd, cleanup } = tmpCwd();
  try {
    const file = persistAllowRule("WebFetch(domain:example.com)", { cwd, persistTarget: "claude-local" });
    assert.equal(file, join(cwd, ".claude", "settings.local.json"));
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    assert.deepEqual(parsed.permissions.allow, ["WebFetch(domain:example.com)"]);
  } finally {
    cleanup();
  }
});

test("corrupt existing file is replaced (documented trade-off), not propagated", () => {
  const { cwd, cleanup } = tmpCwd();
  try {
    const file = join(cwd, ".pi", "permissions.local.json");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(file, "{not json", "utf-8");
    persistAllowRule("Bash(ls)", { cwd });
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    assert.deepEqual(parsed.permissions.allow, ["Bash(ls)"]);
  } finally {
    cleanup();
  }
});

test("written file is parseable pretty JSON with trailing newline", () => {
  const { cwd, cleanup } = tmpCwd();
  try {
    const file = persistAllowRule("Bash(ls)", { cwd });
    const raw = readFileSync(file, "utf-8");
    assert.ok(raw.endsWith("\n"));
    JSON.parse(raw);
  } finally {
    cleanup();
  }
});
