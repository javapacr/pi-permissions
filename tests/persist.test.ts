/**
 * FS3 acceptance: persistence — correct scope formats (project →
 * .pi/permissions.json, global → <agentDir>/permissions.json), dedupe,
 * sibling-key preservation, atomicity (tmp+rename, no residue), and the
 * global write target === loader pi-user read target invariant.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { persistAllowRule } from "../persist.ts";
import { defaultLoaderPaths } from "../loader.ts";

function tmpCwd(): { cwd: string; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "piperm-persist-"));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("project scope writes {permissions:{allow:[spec]}} creating the .pi directory", () => {
  const { cwd, cleanup } = tmpCwd();
  try {
    const file = persistAllowRule("Bash(echo hi)", { cwd, scope: "project" });
    assert.equal(file, join(cwd, ".pi", "permissions.json"));
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
    const file = persistAllowRule("Bash(echo hi)", { cwd, scope: "project" });
    persistAllowRule("Bash(echo hi)", { cwd, scope: "project" });
    persistAllowRule("Bash(echo bye)", { cwd, scope: "project" });
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    assert.deepEqual(parsed.permissions.allow, ["Bash(echo hi)", "Bash(echo bye)"]);
  } finally {
    cleanup();
  }
});

test("preserves sibling keys (top-level + permissions.deny/ask)", () => {
  const { cwd, cleanup } = tmpCwd();
  try {
    const file = join(cwd, ".pi", "permissions.json");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(file, JSON.stringify({
      defaultMode: "acceptEdits",
      permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm *)"], ask: ["Edit(src/**)"] },
    }, null, 2));
    persistAllowRule("Bash(echo hi)", { cwd, scope: "project" });
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    assert.equal(parsed.defaultMode, "acceptEdits");
    assert.deepEqual(parsed.permissions.deny, ["Bash(rm *)"]);
    assert.deepEqual(parsed.permissions.ask, ["Edit(src/**)"]);
    assert.deepEqual(parsed.permissions.allow, ["Bash(ls)", "Bash(echo hi)"]);
  } finally {
    cleanup();
  }
});

test("global scope writes <agentDir>/permissions.json (injected agentDir)", () => {
  const { cwd, cleanup } = tmpCwd();
  const agentDir = mkdtempSync(join(tmpdir(), "piperm-agent-"));
  try {
    const file = persistAllowRule("WebFetch(domain:example.com)", { cwd, scope: "global", agentDir });
    assert.equal(file, join(agentDir, "permissions.json"));
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    assert.deepEqual(parsed.permissions.allow, ["WebFetch(domain:example.com)"]);
    assert.equal(existsSync(join(cwd, ".pi", "permissions.json")), false, "project scope untouched");
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
    cleanup();
  }
});

test("INVARIANT: global write target === loader pi-user read target for the same env", () => {
  const { cwd, cleanup } = tmpCwd();
  const agentDir = mkdtempSync(join(tmpdir(), "piperm-agent-"));
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    const wrote = persistAllowRule("Bash(ls)", { cwd, scope: "global" });
    const reads = defaultLoaderPaths(cwd).piUser;
    assert.equal(wrote, reads, "a dialog-persisted rule must reload from the pi-user scope");
    assert.equal(wrote, join(agentDir, "permissions.json"));
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    rmSync(agentDir, { recursive: true, force: true });
    cleanup();
  }
});

test("corrupt existing file is replaced (documented trade-off), not propagated", () => {
  const { cwd, cleanup } = tmpCwd();
  try {
    const file = join(cwd, ".pi", "permissions.json");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(file, "{not json", "utf-8");
    persistAllowRule("Bash(ls)", { cwd, scope: "project" });
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    assert.deepEqual(parsed.permissions.allow, ["Bash(ls)"]);
  } finally {
    cleanup();
  }
});

test("written file is parseable pretty JSON with trailing newline", () => {
  const { cwd, cleanup } = tmpCwd();
  try {
    const file = persistAllowRule("Bash(ls)", { cwd, scope: "project" });
    const raw = readFileSync(file, "utf-8");
    assert.ok(raw.endsWith("\n"));
    JSON.parse(raw);
  } finally {
    cleanup();
  }
});
