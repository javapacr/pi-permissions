/**
 * Single ask dialog (FS3): `Allow once / Allow for session / Always / Deny /
 * Deny for session`, with a rule-keyed session cache (a matched ask rule
 * shares one approval across all its inputs — `git push origin main` and
 * `origin dev` share `Bash(git push *)`) and fail-closed headless behavior
 * (fixes the bridge's unguarded ui.select).
 *
 * "Always" persists an allow rule (D5) via persist.ts and reports it back so
 * the caller can add it to the live rule set.
 */

import { homedir } from "node:os";
import { resolve } from "node:path";
import type { CanonicalTarget, ParsedRule } from "./types.ts";
import { parseRuleSpec } from "./rules/parse.ts";
import { describeBashRisk } from "./safety.ts";
import { persistAllowRule } from "./persist.ts";

export type AskDecision = "once" | "session" | "always" | "deny" | "deny-session";

export const ASK_OPTIONS = [
  "Allow once",
  "Allow for session",
  "Always",
  "Deny",
  "Deny for session",
] as const;

/** Session-scoped allow/deny memory, keyed on askKey(). */
export class AskCache {
  private readonly allowed = new Set<string>();
  private readonly denied = new Set<string>();

  allow(key: string): void {
    this.allowed.add(key);
    this.denied.delete(key);
  }

  deny(key: string): void {
    this.denied.add(key);
    this.allowed.delete(key);
  }

  isAllowed(key: string): boolean {
    return this.allowed.has(key);
  }

  isDenied(key: string): boolean {
    return this.denied.has(key);
  }

  clear(): void {
    this.allowed.clear();
    this.denied.clear();
  }
}

export type AskUiContext = {
  ui: {
    select: (title: string, options: string[]) => Promise<string | undefined>;
    notify: (message: string, type?: "info" | "warning" | "error") => void;
  };
  hasUI?: boolean;
  cwd?: string;
};

export type AskResult = { allow: true } | { block: true; reason: string };

export type ResolveAskOptions = {
  target: CanonicalTarget;
  /** The ask rule that matched (undefined when a mode baseline prompted). */
  matchedRule?: ParsedRule;
  ctx: AskUiContext;
  mode: string;
  cache: AskCache;
  home?: string;
  /** D5 target override from pi config keys ("claude-local"). */
  persistTarget?: string;
  /** Notified after "Always" persisted; receives (spec, file). */
  onPersist?: (spec: string, file: string) => void;
};

/** Cache key: the matched rule's spec when a rule prompted, else the exact target. */
export function askKey(target: CanonicalTarget, matchedRule?: ParsedRule): string {
  return matchedRule?.spec ?? target.spec;
}

/** Resolve one ask decision point. Never throws. */
export async function resolveAsk(opts: ResolveAskOptions): Promise<AskResult> {
  const key = askKey(opts.target, opts.matchedRule);
  if (opts.cache.isAllowed(key)) return { allow: true };
  if (opts.cache.isDenied(key)) {
    return { block: true, reason: `Denied for this session by user choice: ${key}` };
  }

  const persistable = persistableSpec(opts.target, {
    home: opts.home ?? homedir(),
    cwd: resolve(opts.ctx.cwd ?? process.cwd()),
  });

  if (!opts.ctx.hasUI) {
    return { block: true, reason: headlessReason(opts.target, opts.mode, persistable) };
  }

  const choice = await opts.ctx.ui.select(dialogTitle(opts.target, {
    cwd: opts.ctx.cwd,
    home: opts.home,
  }), [...ASK_OPTIONS]);

  switch (choice) {
    case "Allow once":
      return { allow: true };

    case "Allow for session":
      opts.cache.allow(key);
      return { allow: true };

    case "Always":
      opts.cache.allow(key);
      if (persistable === undefined) {
        opts.ctx.ui.notify(
          `Could not persist an allow rule for ${opts.target.spec} — session allow still applies.`,
          "warning",
        );
      } else {
        try {
          const file = persistAllowRule(persistable, {
            cwd: resolve(opts.ctx.cwd ?? process.cwd()),
            persistTarget: opts.persistTarget,
          });
          opts.onPersist?.(persistable, file);
        } catch (err) {
          opts.ctx.ui.notify(
            `Could not persist an allow rule (${err instanceof Error ? err.message : String(err)}). Session allow still applies.`,
            "warning",
          );
        }
      }
      return { allow: true };

    case "Deny for session":
      opts.cache.deny(key);
      return { block: true, reason: `User denied ${opts.target.spec} (denied for this session)` };

    // "Deny", undefined (esc), and anything unexpected: deny this call only.
    default:
      return { block: true, reason: `User denied ${opts.target.spec}` };
  }
}

/** Dialog title: icon + canonical spec (+ bash risk annotation). */
export function dialogTitle(
  target: CanonicalTarget,
  opts?: { cwd?: string; home?: string },
): string {
  if (target.family === "bash") {
    const risk = describeBashRisk(target.command ?? "", opts);
    return risk.note ? `${risk.icon} ${target.spec}\n   ${risk.note}` : `${risk.icon} ${target.spec}`;
  }
  return `🔒 ${target.spec}`;
}

/**
 * The spec to persist for "Always", or undefined when no sound rule exists:
 * - path targets: `Read|Edit(//<abs>)` — fs-root anchored so the rule
 *   re-matches the approved target from any scope (single-`/` patterns
 *   anchor at each source scope's anchor dir, per FS1 paths semantics);
 *   Write targets persist as Edit (Edit governs Edit+Write; Write(path)
 *   specs are invalid).
 * - webfetch without a hostname: no narrower form than whole-tool — skip
 *   (persisting WebFetch would allow every fetch).
 * - everything else: target.spec as-is (validated below).
 */
export function persistableSpec(
  target: CanonicalTarget,
  ctx: { home: string; cwd: string },
): string | undefined {
  let candidate: string | undefined;
  if (target.family === "path" && target.path !== undefined) {
    const tool = target.tool === "Write" ? "Edit" : target.tool;
    candidate = `${tool}(//${target.path.replace(/^\/+/, "")})`;
  } else if (target.family === "webfetch" && target.hostname === undefined) {
    return undefined;
  } else {
    candidate = target.spec;
  }

  const outcome = parseRuleSpec(candidate, "allow", { home: ctx.home, anchorDir: ctx.cwd, cwd: ctx.cwd });
  return outcome.ok ? candidate : undefined;
}

/** Fail-closed headless reason (fixes the bridge's unguarded ui.select). */
export function headlessReason(
  target: CanonicalTarget,
  mode: string,
  hintSpec?: string,
): string {
  const spec = hintSpec ?? target.spec;
  return `Permission required: ${target.spec} (mode ${mode}, no UI available to ask). `
    + `To proceed: ask the user to approve, add an allow rule — e.g. `
    + `{"permissions":{"allow":["${spec}"]}} in .pi/permissions.local.json — `
    + `or run with --permission-mode bypassPermissions.`;
}
