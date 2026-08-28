/**
 * Always-on safety floor (FS3): catastrophic patterns, critical `rm -rf`,
 * protectedPaths — including READ gating (the never-gated-read hole the
 * backlog fixes). Runs inside the evaluator's checkSafety hook, before
 * deny/ask/allow rules and mode baselines, and cannot be overridden by
 * rules, modes, or dialog choices. Ported from zackify v1.0.6's index.ts
 * floor (see NOTICE), now operating on CanonicalTarget instead of raw tool
 * input so read/grep/find/ls are gated via their shared Read
 * canonicalization.
 */

import { homedir } from "node:os";
import { resolve } from "node:path";
import type { CanonicalTarget } from "./types.ts";

export type Pattern = { pattern: string; description: string };

export type SafetyVerdict = {
  blocked: boolean;
  reason?: string;
};

/** Labeling-only patterns for the ask dialog (⚠️ annotations). */
export const DEFAULT_DANGEROUS: Pattern[] = [
  { pattern: "chmod -R 777", description: "insecure recursive permissions" },
  { pattern: "chown -R", description: "recursive ownership change" },
  { pattern: "> /dev/", description: "direct device write" },
];

/** Floor patterns — always blocking, never overridable (no config escape). */
export const DEFAULT_CATASTROPHIC: Pattern[] = [
  { pattern: "sudo mkfs", description: "sudo filesystem format" },
  { pattern: "mkfs.", description: "filesystem format" },
  { pattern: "dd if=", description: "raw disk write" },
  { pattern: ":(){ :|:& };:", description: "fork bomb" },
  { pattern: "> /dev/sda", description: "overwrite disk" },
  { pattern: "> /dev/nvme", description: "overwrite disk" },
  { pattern: "sudo dd", description: "sudo raw disk operation" },
];

export const DEFAULT_PROTECTED_PATHS = [
  "~/.ssh", "~/.aws", "~/.gnupg", "~/.gpg", "~/.bashrc", "~/.bash_profile",
  "~/.profile", "~/.zshrc", "~/.zprofile", "~/.config/git/credentials",
  "~/.netrc", "~/.npmrc", "~/.docker/config.json", "~/.kube/config", "~/.pi/agent/auth.json",
];

const CRITICAL_DIRS = [
  "/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/opt",
  "/proc", "/root", "/run", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/var",
];

export type SafetyFloorOptions = {
  home: string;
  /** Absolute, `~/`-expanded protected paths. */
  protectedPaths: string[];
  /** Session cwd (rm -rf outside-project labeling). */
  cwd?: string;
};

/** Build the always-on floor as an evaluator checkSafety hook. */
export function makeSafetyFloor(
  opts: SafetyFloorOptions,
): (target: CanonicalTarget) => SafetyVerdict | undefined {
  const cwd = resolve(opts.cwd ?? process.cwd());
  return (target: CanonicalTarget): SafetyVerdict | undefined => {
    if (target.family === "bash") {
      const command = target.command ?? "";

      const critical = checkCriticalRmRf(command, opts.home);
      if (critical) return blocked(`critical rm -rf — ${critical}`);

      const catastrophe = findMatch(command, DEFAULT_CATASTROPHIC);
      if (catastrophe) return blocked(`catastrophic command (${catastrophe.description})`);

      const protectedHit = findProtectedPathInText(command, opts.home, opts.protectedPaths);
      if (protectedHit) return blocked(`bash command references protected path ${protectedHit}`);

      return undefined;
    }

    if (target.family === "path" && target.path !== undefined) {
      const targetPath = target.path;
      const hit = opts.protectedPaths.find((p) => targetPath === p || targetPath.startsWith(p + "/"));
      if (hit) return blocked(`${target.tool.toLowerCase()} of protected path ${readablePath(hit, opts.home)}`);
    }

    return undefined;
  };
}

/** Thin standalone entry (the FS3 stub name); see makeSafetyFloor. */
export function checkSafety(
  target: CanonicalTarget,
  opts: SafetyFloorOptions,
): SafetyVerdict | undefined {
  return makeSafetyFloor(opts)(target);
}

function blocked(what: string): SafetyVerdict {
  return {
    blocked: true,
    reason: `Blocked by safety floor: ${what}. This cannot be overridden by rules or mode.`,
  };
}

/** Dialog labeling for bash commands: ⚠️ dangerous / 🚫 catastrophic. */
export function describeBashRisk(
  command: string,
  opts?: { cwd?: string; home?: string },
): { icon: "🔒" | "⚠️" | "🚫"; note?: string } {
  const catastrophe = findMatch(command, DEFAULT_CATASTROPHIC);
  if (catastrophe) return { icon: "🚫", note: `🚫 CATASTROPHIC: ${catastrophe.description}` };
  const danger = findMatch(command, DEFAULT_DANGEROUS);
  if (danger) return { icon: "⚠️", note: `⚠️  DANGEROUS: ${danger.description}` };
  const rmDanger = checkDangerousRmRf(command, resolve(opts?.cwd ?? process.cwd()), opts?.home);
  if (rmDanger) return { icon: "⚠️", note: `⚠️  DANGEROUS: ${rmDanger.description}` };
  return { icon: "🔒" };
}

function readablePath(absolute: string, home: string): string {
  return home && absolute.startsWith(home) ? absolute.replace(home, "~") : absolute;
}

/** zackify's command-text check: absolute OR `~`-form reference to a protected path. */
function findProtectedPathInText(
  command: string,
  home: string,
  protectedPaths: string[],
): string | undefined {
  for (const path of protectedPaths) {
    if (command.includes(path) || command.includes(path.replace(home, "~"))) {
      return readablePath(path, home);
    }
  }
  return undefined;
}

function findMatch(command: string, patterns: Pattern[]): Pattern | undefined {
  return patterns.find((pattern) => command.includes(pattern.pattern));
}

/** Critical `rm -rf` detection (ported verbatim from zackify, home injectable). */
export function checkCriticalRmRf(command: string, home: string = homedir()): string | null {
  for (const pattern of rmRfPatterns()) {
    const match = command.match(pattern);
    if (!match) continue;

    const targets = match[1]!.trim().split(/\s+/).filter((target) => !target.startsWith("-"));

    for (const target of targets) {
      const resolved = resolveAbsoluteShellTarget(target, home);
      if (!resolved) continue;

      const normalized = resolved.replace(/\/+$/, "") || "/";
      if (normalized === "/") return "rm -rf / — recursive delete root";
      if (normalized === home) return "rm -rf ~ — recursive delete entire home directory";
      if (CRITICAL_DIRS.includes(normalized)) return `rm -rf ${normalized} — recursive delete critical system directory`;
    }
  }

  if (/\bsudo\s+/.test(command)) {
    const nested = checkCriticalRmRf(command.replace(/\bsudo\s+/, ""), home);
    if (nested) return `sudo ${nested}`;
  }

  return null;
}

/** Labeling-only: `rm -rf` targeting outside the project (dialog ⚠️). */
export function checkDangerousRmRf(
  command: string,
  cwd: string,
  home: string = homedir(),
): { description: string } | null {
  for (const pattern of rmRfPatterns()) {
    const match = command.match(pattern);
    if (!match) continue;

    const rawArgs = match[1]!.trim().split(/\s*(?:&&|\|\||[;|])\s*/)[0]!;
    const targets = rawArgs.split(/\s+/).filter((target) => !target.startsWith("-") && target.length > 0);
    const normalizedCwd = resolve(cwd);

    for (const target of targets) {
      const normalized = resolveShellTarget(target, cwd, home);
      if (normalized === normalizedCwd || normalized.startsWith(normalizedCwd + "/")) continue;
      return { description: `recursive force delete outside project (${target})` };
    }

    return null;
  }

  return null;
}

function rmRfPatterns() {
  return [
    /\brm\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+(.*)/i,
    /\brm\s+-r\s+-f\s+(.*)/i,
    /\brm\s+-f\s+-r\s+(.*)/i,
  ];
}

function resolveAbsoluteShellTarget(target: string, home: string): string | null {
  if (target === "~") return home;
  if (target.startsWith("~/")) return resolve(home, target.slice(2));
  if (target === "/*") return "/";
  if (target.startsWith("/")) return target;
  return null;
}

function resolveShellTarget(target: string, cwd: string, home: string): string {
  if (target === "~") return home;
  if (target.startsWith("~/")) return resolve(home, target.slice(2));
  if (target.startsWith("/")) return resolve(target);
  return resolve(cwd, target);
}
