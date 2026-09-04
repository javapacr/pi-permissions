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
import { basename, resolve } from "node:path";
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
  // R8 (review): the per-profile credential files — profiles run with their own
  // PI_CODING_AGENT_DIR, and the agent-dir entry above does not cover them.
  "~/.pi/personal/auth.json", "~/.pi/work/auth.json",
];

const CRITICAL_DIRS = [
  "/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/opt",
  "/proc", "/root", "/run", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/var",
];

export type SafetyFloorOptions = {
  home: string;
  /** Absolute, `~/`-expanded protected paths. */
  protectedPaths: string[];
  /** Session cwd (rm -rf outside-project labeling + relative-target critical-dir detection). */
  cwd?: string;
};

/**
 * Static shell-variable expansion for floor reasoning (R2): $HOME, ${HOME},
 * $USER, ${USER} — the forms an unmodified model naturally emits. Command
 * substitution `$(…)` is deliberately NOT expanded (documented limitation,
 * parked: closing it requires shell-level evaluation).
 */
export function expandShellVars(command: string, home: string): string {
  const user = basename(home);
  return command
    .replace(/\$\{HOME\}/g, home)
    .replace(/\$HOME\b/g, home)
    .replace(/\$\{USER\}/g, user)
    .replace(/\$USER\b/g, user);
}

/** Long-flag normalization for rm (R2): `--recursive`/`--force` → short flags
 * so the short-flag rmRfPatterns also cover long-flag spellings. */
function normalizeRmLongFlags(command: string): string {
  return command.replace(/--recursive\b/g, "-r").replace(/--force\b/g, "-f");
}

/** Build the always-on floor as an evaluator checkSafety hook. */
export function makeSafetyFloor(
  opts: SafetyFloorOptions,
): (target: CanonicalTarget) => SafetyVerdict | undefined {
  const cwd = resolve(opts.cwd ?? process.cwd());
  return (target: CanonicalTarget): SafetyVerdict | undefined => {
    if (target.family === "bash") {
      // R2: reason about the variable-expanded command text so env-var
      // indirection ($HOME/.ssh/…) cannot slip past the floor.
      const command = expandShellVars(target.command ?? "", opts.home);

      const critical = checkCriticalRmRf(command, opts.home, cwd);
      if (critical) return blocked(`critical rm -rf — ${critical}`);

      const catastrophe = findMatch(command, DEFAULT_CATASTROPHIC);
      if (catastrophe) return blocked(`catastrophic command (${catastrophe.description})`);

      const protectedHit = findProtectedPathInText(command, opts.home, opts.protectedPaths);
      if (protectedHit) {
        return blocked(
          `bash command references protected path ${protectedHit.path} (matched ${JSON.stringify(protectedHit.matchedText)} at offset ${protectedHit.index} of evaluated command: ${contextSnippet(command, protectedHit.index, protectedHit.matchedText.length)})`,
        );
      }

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

/** zackify's command-text check: absolute OR `~`-form reference to a protected path.
 * Reports WHERE it matched (variant + offset) so block reasons are falsifiable
 * from the outside — a floor that cannot be overridden must not produce
 * unfalsifiable claims (P1 false-positive 2026-09-04). */
type ProtectedPathHit = {
  /** Readable (`~/`-collapsed) protected path for the reason prefix. */
  path: string;
  /** The exact variant found in the command text (absolute or ~ form). */
  matchedText: string;
  /** Offset of matchedText within the evaluated command. */
  index: number;
};

function findProtectedPathInText(
  command: string,
  home: string,
  protectedPaths: string[],
): ProtectedPathHit | undefined {
  for (const path of protectedPaths) {
    const tildeForm = path.replace(home, "~");
    const candidates = [
      { text: path, index: command.indexOf(path) },
      { text: tildeForm, index: tildeForm === path ? -1 : command.indexOf(tildeForm) },
    ].filter((candidate) => candidate.index !== -1).sort((a, b) => a.index - b.index);
    const hit = candidates[0];
    if (hit) return { path: readablePath(path, home), matchedText: hit.text, index: hit.index };
  }
  return undefined;
}

/** ~100-char single-line context window around the match, newline-collapsed,
 * ellipsized when truncated. */
function contextSnippet(text: string, index: number, length: number, window = 100): string {
  const start = Math.max(0, index - Math.floor(window / 2));
  const end = Math.min(text.length, index + length + Math.floor(window / 2));
  const body = text.slice(start, end).replace(/\s+/g, " ");
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

function findMatch(command: string, patterns: Pattern[]): Pattern | undefined {
  return patterns.find((pattern) => command.includes(pattern.pattern));
}

/** Critical `rm -rf` detection (zackify port; R2-hardened: long-flag variants,
 * path normalization (`//etc`, `/etc/../etc`), and cwd-relative targets). */
export function checkCriticalRmRf(command: string, home: string = homedir(), cwd?: string): string | null {
  // R2: check both the raw text and the long-flag-normalized variant — the
  // short-flag patterns then cover `rm --recursive --force /etc` spellings.
  for (const variant of [command, normalizeRmLongFlags(command)]) {
    const hit = checkCriticalRmRfVariant(variant, home, cwd);
    if (hit) return hit;
  }

  if (/\bsudo\s+/.test(command)) {
    const nested = checkCriticalRmRf(command.replace(/\bsudo\s+/, ""), home, cwd);
    if (nested) return `sudo ${nested}`;
  }

  return null;
}

function checkCriticalRmRfVariant(command: string, home: string, cwd?: string): string | null {
  for (const pattern of rmRfPatterns()) {
    const match = command.match(pattern);
    if (!match) continue;

    const targets = match[1]!.trim().split(/\s+/).filter((target) => !target.startsWith("-"));

    for (const target of targets) {
      const resolved = resolveAbsoluteShellTarget(target, home, cwd);
      if (!resolved) continue;

      const normalized = resolved.replace(/\/+$/, "") || "/";
      if (normalized === "/") return "rm -rf / — recursive delete root";
      if (normalized === home) return "rm -rf ~ — recursive delete entire home directory";
      if (CRITICAL_DIRS.includes(normalized)) return `rm -rf ${normalized} — recursive delete critical system directory`;
    }
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

function resolveAbsoluteShellTarget(target: string, home: string, cwd?: string): string | null {
  if (target === "~") return home;
  if (target.startsWith("~/")) return resolve(home, target.slice(2));
  if (target === "/*") return "/";
  // R2: resolve() normalizes `//etc` and `/etc/../etc` forms before the
  // CRITICAL_DIRS comparison (raw-string compare missed both).
  if (target.startsWith("/")) return resolve(target);
  // R2: relative targets (rm -rf ../../../../..) resolve against the session
  // cwd when known, so deep-upward deletes that reach a critical dir are caught.
  if (cwd !== undefined) return resolve(cwd, target);
  return null;
}

function resolveShellTarget(target: string, cwd: string, home: string): string {
  if (target === "~") return home;
  if (target.startsWith("~/")) return resolve(home, target.slice(2));
  if (target.startsWith("/")) return resolve(target);
  return resolve(cwd, target);
}
