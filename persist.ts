/**
 * Atomic persistence of dialog allow rules (FS3, D5 revised 2026-08-30):
 * - scope "project" → `<cwd>/.pi/permissions.json` (committed project config);
 * - scope "global" → `<agentDir>/permissions.json` (pi-user scope; agentDir
 *   via getPiAgentDir() — honors PI_CODING_AGENT_DIR, default ~/.pi/agent —
 *   the exact path loader.ts reads, so a persisted rule reloads next session);
 * - read-modify-write preserving every other key, exact-string dedupe;
 * - atomic via tmp file + rename in the same directory.
 *
 * `agentDir` is test injection only; production call sites omit it.
 * Corrupt/unreadable existing files are treated as absent (documented in
 * NOTES — the caller surfaces a notify, the session allow still applies).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getPiAgentDir } from "./canonicalize.ts";

export type PersistScope = "project" | "global";

export type PersistOptions = {
  cwd: string;
  /** Which config file receives the rule (D5 revised: project or global). */
  scope: PersistScope;
  /** Test injection only: overrides getPiAgentDir() for scope "global". */
  agentDir?: string;
};

/** Append `spec` to the target scope's allow list. Returns the file written. */
export function persistAllowRule(spec: string, opts: PersistOptions): string {
  const cwd = resolve(opts.cwd);
  const file = opts.scope === "global"
    ? join(opts.agentDir ?? getPiAgentDir(), "permissions.json")
    : join(cwd, ".pi", "permissions.json");

  let root: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      root = parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or corrupt — start from an empty document (NOTES: documented trade-off).
  }

  const permissions = root.permissions && typeof root.permissions === "object" && !Array.isArray(root.permissions)
    ? { ...(root.permissions as Record<string, unknown>) }
    : {};
  const allow = Array.isArray(permissions.allow) ? [...permissions.allow] : [];
  if (!allow.includes(spec)) allow.push(spec);
  permissions.allow = allow;
  root.permissions = permissions;

  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
  renameSync(tmp, file);
  return file;
}
