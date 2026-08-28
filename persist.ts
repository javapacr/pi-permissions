/**
 * Atomic persistence of "Always allow" rules (FS3, D5):
 * - default target `.pi/permissions.local.json` (machine-local, gitignored);
 * - `persistTarget: "claude-local"` config honored → `.claude/settings.local.json`;
 * - read-modify-write preserving every other key, exact-string dedupe;
 * - atomic via tmp file + rename in the same directory.
 *
 * Corrupt/unreadable existing files are treated as absent (documented in
 * NOTES — the caller surfaces a notify, the session allow still applies).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type PersistOptions = {
  cwd: string;
  /** "claude-local" → .claude/settings.local.json; anything else → pi-local (D5). */
  persistTarget?: string;
};

/** Append `spec` to the target scope's allow list. Returns the file written. */
export function persistAllowRule(spec: string, opts: PersistOptions): string {
  const cwd = resolve(opts.cwd);
  const file = opts.persistTarget === "claude-local"
    ? join(cwd, ".claude", "settings.local.json")
    : join(cwd, ".pi", "permissions.local.json");

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
