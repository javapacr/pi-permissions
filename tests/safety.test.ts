/**
 * FS3 acceptance: the always-on safety floor — catastrophic patterns,
 * critical rm -rf, protectedPaths (bash text + path targets, READ included),
 * and the dialog risk describer. Direct unit tests on CanonicalTargets.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCriticalRmRf, describeBashRisk, makeSafetyFloor } from "../safety.ts";
import * as reExports from "../safety.ts";
import type { CanonicalTarget } from "../types.ts";

const HOME = "/home/u";
const PROTECTED = ["/home/u/.ssh", "/home/u/.pi/agent/auth.json"];
const floor = makeSafetyFloor({ home: HOME, protectedPaths: PROTECTED, cwd: "/proj" });

const bashTarget = (command: string): CanonicalTarget => ({
  spec: `Bash(${command})`, family: "bash", tool: "Bash", piTool: "bash", command,
});
const pathTarget = (tool: "Read" | "Edit" | "Write", path: string): CanonicalTarget => ({
  spec: `${tool}(${path})`, family: "path", tool, piTool: tool.toLowerCase(), path,
});

test("floor: critical rm -rf targets block (/ , ~ , critical dirs, sudo)", () => {
  for (const command of ["rm -rf /", "rm -rf ~", "rm -rf /usr", "sudo rm -rf /etc", "rm -rf /etc", "rm -rf /home"]) {
    const verdict = floor(bashTarget(command));
    assert.equal(verdict?.blocked, true, `must block: ${command}`);
    assert.match(verdict!.reason!, /Blocked by safety floor: critical rm -rf/);
    assert.match(verdict!.reason!, /cannot be overridden/);
  }
});

test("floor: checkCriticalRmRf returns the matching description", () => {
  assert.match(checkCriticalRmRf("rm -rf /", HOME)!, /recursive delete root/);
  assert.match(checkCriticalRmRf("rm -rf ~", HOME)!, /entire home directory/);
  // The base pattern matches "sudo rm -rf /bin" directly (\brm is
  // position-independent), so no sudo prefix is prepended — verbatim port.
  assert.match(checkCriticalRmRf("sudo rm -rf /bin", HOME)!, /critical system directory/);
  assert.equal(checkCriticalRmRf(`rm -rf /proj/build`, HOME), null, "project-local rm -rf is not critical");
});

test("floor: catastrophic patterns block", () => {
  for (const command of ["sudo mkfs /dev/sda1", "mkfs.ext4 /dev/sdb", "dd if=x of=y", ":(){ :|:& };:"]) {
    const verdict = floor(bashTarget(command));
    assert.equal(verdict?.blocked, true, `must block: ${command}`);
    assert.match(verdict!.reason!, /catastrophic command/);
  }
});

test("floor: bash referencing protected paths blocks (absolute and ~ forms)", () => {
  const abs = floor(bashTarget("cat /home/u/.ssh/id_rsa"));
  assert.equal(abs?.blocked, true);
  assert.match(abs!.reason!, /protected path ~/);
  const tilde = floor(bashTarget("cat ~/.ssh/id_rsa"));
  assert.equal(tilde?.blocked, true, "~ form must also match");
  const auth = floor(bashTarget("open ~/.pi/agent/auth.json"));
  assert.equal(auth?.blocked, true);
});

test("floor: READ of a protected path blocks (the never-gated-read hole fixed)", () => {
  const verdict = floor(pathTarget("Read", "/home/u/.pi/agent/auth.json"));
  assert.equal(verdict?.blocked, true);
  assert.match(verdict!.reason!, /read of protected path/);
  const clean = floor(pathTarget("Read", "/proj/src/a.ts"));
  assert.equal(clean, undefined);
});

test("floor: Edit/Write of protected paths block; Edit/Write elsewhere pass", () => {
  assert.equal(floor(pathTarget("Edit", "/home/u/.ssh/config"))?.blocked, true);
  assert.equal(floor(pathTarget("Write", "/home/u/.ssh/known_hosts.new"))?.blocked, true);
  assert.equal(floor(pathTarget("Edit", "/proj/src/a.ts")), undefined);
  // Under a protected directory, not just exact.
  assert.equal(floor(pathTarget("Edit", "/home/u/.ssh/sub/x"))?.blocked, true);
});

test("floor: non-bash/path families pass through to the evaluator", () => {
  assert.equal(floor({ spec: "WebFetch(domain:x.com)", family: "webfetch", tool: "WebFetch", piTool: "web_fetch", hostname: "x.com" }), undefined);
  assert.equal(floor({ spec: "Agent(worker)", family: "agent", tool: "Agent", piTool: "subagent", agent: "worker" }), undefined);
  assert.equal(floor({ spec: "todo", family: "other", tool: "todo", piTool: "todo" }), undefined);
});

test("floor: ordinary bash passes (not over-triggered)", () => {
  assert.equal(floor(bashTarget("echo hi")), undefined);
  assert.equal(floor(bashTarget("npm test")), undefined);
  assert.equal(floor(bashTarget("rm -rf /proj/build")), undefined);
  assert.equal(floor(bashTarget("cat /proj/notes.txt")), undefined);
});

test("describer: ⚠️ dangerous, ⚠️ outside-project rm -rf, 🚫 catastrophic, 🔒 clean", () => {
  assert.deepEqual(describeBashRisk("chmod -R 777 /tmp/x", { cwd: "/proj", home: HOME }), {
    icon: "⚠️",
    note: "⚠️  DANGEROUS: insecure recursive permissions",
  });
  const rm = describeBashRisk("rm -rf /tmp/elsewhere", { cwd: "/proj", home: HOME });
  assert.equal(rm.icon, "⚠️");
  assert.match(rm.note!, /outside project/);
  assert.equal(describeBashRisk("sudo mkfs /dev/sda1", { cwd: "/proj", home: HOME }).icon, "🚫");
  assert.deepEqual(describeBashRisk("echo hi", { cwd: "/proj", home: HOME }), { icon: "🔒" });
});

// ---------------------------------------------------------------------------
// R2 + R7 (review window): adversarial floor table — every textual-evasion form
// found by the 5-angle review, each pinned as a DECISION (blocked or
// documented-accepted). A regression here is a floor bypass.
// ---------------------------------------------------------------------------

const ADV_FLOOR = makeSafetyFloor({ home: HOME, protectedPaths: PROTECTED, cwd: "/home/u/proj" });

test("R2/R7 adversarial table: env-var indirection blocks", () => {
  for (const command of [
    "cat $HOME/.ssh/id_rsa",
    "cat ${HOME}/.ssh/id_rsa",
    "cp $HOME/.pi/agent/auth.json /tmp/x",
    "rm -rf $HOME",
    "rm -rf ${HOME}",
  ]) {
    const verdict = ADV_FLOOR(bashTarget(command));
    assert.equal(verdict?.blocked, true, `must block: ${command}`);
    assert.match(verdict!.reason!, /safety floor/);
  }
});

test("R2/R7 adversarial table: long-flag rm variants block", () => {
  for (const command of [
    "rm --recursive --force /etc",
    "rm --force --recursive /etc",
    "rm --recursive -f /bin",
    "rm -r --force /usr",
    "sudo rm --recursive --force /",
  ]) {
    assert.equal(ADV_FLOOR(bashTarget(command))?.blocked, true, `must block: ${command}`);
  }
});

test("R2/R7 adversarial table: path-normalization forms block", () => {
  for (const command of ["rm -rf //etc", "rm -rf /etc/../etc", "rm -rf /usr/../../usr"]) {
    assert.equal(ADV_FLOOR(bashTarget(command))?.blocked, true, `must block: ${command}`);
  }
});

test("R2/R7 adversarial table: cwd-relative upward deletes that reach critical dirs block", () => {
  // cwd = /home/u/proj → ../../.. = /home (critical); ../../../.. = /
  assert.equal(ADV_FLOOR(bashTarget("rm -rf ../../.."))?.blocked, true, "/home reached");
  assert.equal(ADV_FLOOR(bashTarget("rm -rf ../../../.."))?.blocked, true, "/ reached");
  // Project-local relatives stay free (no over-trigger):
  assert.equal(ADV_FLOOR(bashTarget("rm -rf build")), undefined);
  assert.equal(ADV_FLOOR(bashTarget("rm -rf ../sibling")), undefined, "/home/u reached — not critical, home itself is not deleted");
});

test("R2/R7 adversarial table: documented-accepted evasion (command substitution) stays unpinned-open", () => {
  // `$(...)` is deliberately NOT expanded (no shell evaluation in the floor).
  // Pinned as a DECISION so an accidental "fix" that changes matching shows up.
  assert.equal(ADV_FLOOR(bashTarget("cat ~/.s$(echo sh)/id_rsa")), undefined);
  // Same class: `..`-segments inside expanded path-like text are not normalized
  // (`cat $USER/../u/.ssh` → `cat u/../u/.ssh` — no literal protected substring).
  assert.equal(ADV_FLOOR(bashTarget("cat $USER/../u/.ssh/id_rsa")), undefined);
});

test("R2/R7 adversarial table: straight forms still block (regression guard)", () => {
  assert.equal(ADV_FLOOR(bashTarget("cat ~/.ssh/config"))?.blocked, true);
  assert.equal(ADV_FLOOR(bashTarget("rm -rf /"))?.blocked, true);
  assert.equal(ADV_FLOOR(bashTarget("cat /home/u/.ssh/id_rsa"))?.blocked, true);
});

test("R2: expandShellVars unit (HOME/USER forms, word boundaries, no substitution)", () => {
  const expandShellVars = reExports.expandShellVars;
  assert.equal(expandShellVars("cat $HOME/.ssh", "/home/u"), "cat /home/u/.ssh");
  assert.equal(expandShellVars("cat ${HOME}/.ssh", "/home/u"), "cat /home/u/.ssh");
  assert.equal(expandShellVars("echo $USER", "/home/u"), "echo u");
  assert.equal(expandShellVars("echo $HOMES", "/home/u"), "echo $HOMES", "word boundary respected");
  assert.equal(expandShellVars("echo $(whoami)", "/home/u"), "echo $(whoami)", "no command substitution");
});

// ---------------------------------------------------------------------------
// R8 (review window): per-profile credential files join the DEFAULT protected
// list (read-gated floor) — matcher handles explicit entries natively.
// ---------------------------------------------------------------------------

test("R8: DEFAULT_PROTECTED_PATHS covers per-profile auth files", () => {
  const { DEFAULT_PROTECTED_PATHS } = reExports;
  assert.ok(DEFAULT_PROTECTED_PATHS.includes("~/.pi/personal/auth.json"));
  assert.ok(DEFAULT_PROTECTED_PATHS.includes("~/.pi/work/auth.json"));
});

test("R8: profile auth reads/writes block under the defaults (bash text + path family)", () => {
  const { DEFAULT_PROTECTED_PATHS } = reExports;
  const expanded = DEFAULT_PROTECTED_PATHS.map((p) => (p.startsWith("~/") ? p.replace(/^~/, HOME) : p));
  const r8floor = makeSafetyFloor({ home: HOME, protectedPaths: expanded, cwd: "/home/u/proj" });
  assert.equal(r8floor(bashTarget("cat ~/.pi/work/auth.json"))?.blocked, true, "~ form bash text");
  assert.equal(r8floor(bashTarget("cat $HOME/.pi/personal/auth.json"))?.blocked, true, "expanded env form");
  assert.equal(r8floor(pathTarget("Read", "/home/u/.pi/work/auth.json"))?.blocked, true, "read-gated");
  assert.equal(r8floor(pathTarget("Edit", "/home/u/.pi/personal/auth.json"))?.blocked, true, "edit-gated");
});

