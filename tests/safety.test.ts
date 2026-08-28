/**
 * FS3 acceptance: the always-on safety floor — catastrophic patterns,
 * critical rm -rf, protectedPaths (bash text + path targets, READ included),
 * and the dialog risk describer. Direct unit tests on CanonicalTargets.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCriticalRmRf, describeBashRisk, makeSafetyFloor } from "../safety.ts";
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
