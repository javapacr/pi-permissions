/**
 * Dual-source rule loader: 3 Claude scopes + 3 pi scopes, union + dedupe,
 * deny-dominance, per-source provenance retained for display/persist.
 * TODO(FS1) — filled by the rule-engine core; see
 * docs/pi-permissions-backlog.md §FS1 (decisions D3/D6/D7).
 */
export type RuleSource = {
  /** Absolute path of the config file the rules came from. */
  file: string;
  scope: "claude-global" | "claude-project" | "claude-local" | "pi-user" | "pi-project" | "pi-local";
};

export type LoadedRules = {
  /** Merged rules across all sources, deduped, deny-dominant. */
  rules: string[];
  sources: RuleSource[];
};

export function loadRules(_cwd: string): LoadedRules {
  throw new Error("pi-permissions: loadRules is implemented in FS1");
}
