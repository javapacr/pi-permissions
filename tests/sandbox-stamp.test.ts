/**
 * P1 regression 2026-09-04 — cross-extension contract with pi-claude-sandbox.
 *
 * The sandbox's tool_call listener replaces `event.input.command` with the
 * full wrap (`env … /usr/bin/sandbox-exec -p '<seatbelt profile>' zsh -c '…'`),
 * and that profile embeds protected paths (`deny file-read* /Users/reevonr/.ssh`,
 * `allow file-read* …/known_hosts`) on EVERY bash call. Extension tool_call
 * listeners race: when the floor read the input after the sandbox wrote it,
 * every bash command — `echo probe-ok` included — was blocked with
 * "Blocked by safety floor: bash command references protected path ~/.ssh".
 *
 * The sandbox now stamps the user's ORIGINAL command on the input under
 * Symbol.for("pi-claude-sandbox.original-command") BEFORE mutating; the
 * canonicalizer must prefer that stamp so rules + the floor always evaluate
 * the user's command, never the wrap plumbing — regardless of listener timing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize } from "../canonicalize.ts";
import { evaluate } from "../evaluator.ts";
import { makeSafetyFloor } from "../safety.ts";
import type { CanonicalTarget } from "../types.ts";

const STAMP = Symbol.for("pi-claude-sandbox.original-command");
const HOME = "/Users/reevonr";
const floor = makeSafetyFloor({
  home: HOME,
  protectedPaths: [`${HOME}/.ssh`, `${HOME}/.aws`, `${HOME}/.pi/agent/auth.json`],
  cwd: "/proj",
});

const bashTarget = (command: string): CanonicalTarget => ({
  spec: `Bash(${command})`, family: "bash", tool: "Bash", piTool: "bash", command,
});

/** Wrap-shaped text: protected paths from the inlined profile, clean inner command. */
const WRAPPED = `env -u AWS_SECRET_ACCESS_KEY /usr/bin/sandbox-exec -p '(version 1)(deny file-read* (subpath "/Users/reevonr/.ssh"))(allow file-read* (literal "/Users/reevonr/.ssh/known_hosts"))' /bin/zsh -c 'echo probe-ok'`;

function stampedInput(command: string, wrapped: string): Record<string, unknown> {
  const input: Record<string, unknown> = { command: wrapped };
  Object.defineProperty(input, STAMP, {
    value: command, enumerable: false, configurable: true, writable: true,
  });
  return input;
}

test("floor: clean commands pass (P1 false-positive regression, no stamp involved)", () => {
  for (const command of [
    "echo probe-ok",
    "pwd",
    "git status --short --branch",
    "cd /proj && git status && (pgrep -fl host-entry || echo none) && ls /private/tmp/x 2>&1 | head -20",
  ]) {
    assert.equal(floor(bashTarget(command)), undefined, `must pass: ${command}`);
  }
});

test("canonicalize prefers the sandbox-stamped original; wrapped+stamped does not block", () => {
  const target = canonicalize("bash", stampedInput("echo probe-ok", WRAPPED), {
    home: HOME, cwd: "/proj",
  });
  assert.equal(target.family, "bash");
  assert.equal(target.command, "echo probe-ok");
  assert.equal(target.spec, "Bash(echo probe-ok)");

  const verdict = evaluate([], target, { checkSafety: floor });
  assert.notEqual(verdict.action, "deny");
});

test("the same wrapped string WITHOUT the stamp still blocks (floor stays honest)", () => {
  const target = canonicalize("bash", { command: WRAPPED }, { home: HOME, cwd: "/proj" });
  assert.equal(target.command, WRAPPED);

  const verdict = evaluate([], target, { checkSafety: floor });
  assert.equal(verdict.action, "deny");
  assert.equal(verdict.source, "safety");
  assert.match(verdict.safetyReason ?? "", /protected path ~/);
});

test("a stamped original that genuinely references ~/.ssh still blocks, with enriched reason", () => {
  const target = canonicalize("bash", stampedInput("cat ~/.ssh/id_rsa", WRAPPED), {
    home: HOME, cwd: "/proj",
  });
  assert.equal(target.command, "cat ~/.ssh/id_rsa");

  const verdict = evaluate([], target, { checkSafety: floor });
  assert.equal(verdict.action, "deny");
  assert.match(verdict.safetyReason ?? "", /matched "/);
  assert.match(verdict.safetyReason ?? "", /at offset \d+/);
  assert.match(verdict.safetyReason ?? "", /of evaluated command:/);
});

test("enriched reason keeps the exact prefix/suffix envelope and stays single-line", () => {
  const verdict = floor(bashTarget("cat /Users/reevonr/.ssh/id_rsa"));
  assert.equal(verdict?.blocked, true);
  const reason = verdict!.reason!;
  assert.ok(reason.startsWith("Blocked by safety floor: "), reason);
  assert.ok(reason.endsWith("This cannot be overridden by rules or mode."), reason);
  assert.match(reason, /\(matched "\/Users\/reevonr\/\.ssh" at offset \d+ of evaluated command: /);
  assert.ok(!reason.includes("\n"), "reason must be single-line");
});

test("canonicalize without the stamp behaves exactly as before (plain command)", () => {
  const target = canonicalize("bash", { command: "echo probe-ok" }, { home: HOME, cwd: "/proj" });
  assert.equal(target.command, "echo probe-ok");
  assert.equal(target.spec, "Bash(echo probe-ok)");
});
