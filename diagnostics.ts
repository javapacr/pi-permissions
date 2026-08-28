/**
 * FS5 `/permissions` diagnostics rendering (doctor-style) — pure functions
 * over an assembled state snapshot; the command handler (index.ts) turns the
 * sections into paged select dialogs. No I/O.
 *
 * Sections: Mode (+ how it was set), Rules grouped by primary source file
 * with multi-file provenance annotations, Issues (invalid specs with file +
 * message — the FS1 RuleIssue surface), Children (agentModes overrides +
 * inheritance channel state), Hot-reload (watched dirs + pending flag +
 * last-reload time), and All (concatenation).
 */

import type { ParsedRule, RuleIssue } from "./types.ts";
import type { PermissionMode } from "./modes.ts";
import { getModeMeta } from "./modes.ts";

/** How the active mode came to be (diagnostics display only). */
export type ModeOrigin = "flag" | "config" | "hard-default" | "shortcut" | "picker";

export const MODE_ORIGIN_LABELS: Record<ModeOrigin, string> = {
  "flag": "set by --permission-mode flag",
  "config": "set by defaultMode config",
  "hard-default": "hard startup default (no flag, no defaultMode)",
  "shortcut": "set by ctrl+shift+m cycling",
  "picker": "set via /permissions picker",
};

export type DiagnosticsState = {
  mode: PermissionMode;
  modeOrigin: ModeOrigin;
  rules: ParsedRule[];
  issues: RuleIssue[];
  /** Files actually read at the last load, in scope order. */
  sources: Array<{ file: string; scope: string }>;
  /** `children` config key (agentModes overrides live under it), if any. */
  childrenKeys?: Record<string, unknown>;
  /** Directories under active watch; empty array = watcher inactive. */
  watchedDirs: string[];
  /** A relevant change fired but the next tool call has not reloaded yet. */
  reloadPending: boolean;
  /** ISO timestamp of the last successful rule load. */
  loadedAt: string;
};

export type DiagnosticsSection = {
  key: "mode" | "rules" | "issues" | "children" | "hot-reload";
  title: string;
  lines: string[];
};

const SCOPE_LABELS: Record<string, string> = {
  "claude-global": "Claude user (global)",
  "claude-project": "Claude project",
  "claude-local": "Claude local",
  "pi-user": "pi user",
  "pi-project": "pi project",
  "pi-local": "pi local",
};

export function ruleCounts(rules: ParsedRule[]): { allow: number; deny: number; ask: number } {
  const counts = { allow: 0, deny: 0, ask: 0 };
  for (const rule of rules) counts[rule.action] += 1;
  return counts;
}

/** Compact status-bar form, e.g. `π 12a·3d·1q` (+ ` ⚠2` when issues exist). */
export function rulesStatusText(rules: ParsedRule[], issues: RuleIssue[]): string {
  const c = ruleCounts(rules);
  const base = `π ${c.allow}a·${c.deny}d·${c.ask}q`;
  return issues.length > 0 ? `${base} ⚠${issues.length}` : base;
}

/** Rules grouped by primary source (sources[0]); deduped rules that came
 *  from several files carry a `+N more` provenance annotation. */
export function groupRulesBySource(
  state: Pick<DiagnosticsState, "rules" | "sources">,
): Array<{ file: string; scope: string; rules: ParsedRule[] }> {
  return state.sources.map(({ file, scope }) => ({
    file,
    scope: SCOPE_LABELS[scope] ?? scope,
    rules: state.rules.filter((rule) => rule.sources[0] === file),
  }));
}

function ruleLine(rule: ParsedRule): string {
  const extra = rule.sources.length > 1 ? `  (+${rule.sources.length - 1} more source${rule.sources.length > 2 ? "s" : ""})` : "";
  return `  ${rule.action.padEnd(5)} ${rule.spec}${extra}`;
}

export function renderModeSection(state: DiagnosticsState): string[] {
  const meta = getModeMeta(state.mode);
  return [
    `Active mode: ${meta.label} (${state.mode})`,
    `How it was set: ${MODE_ORIGIN_LABELS[state.modeOrigin]}`,
    `Cycle order: default → acceptEdits → production-support → bypass (ctrl+shift+m)`,
    `Description: ${meta.description}`,
  ];
}

export function renderRulesSection(state: DiagnosticsState): string[] {
  const groups = groupRulesBySource(state);
  const lines: string[] = [`Rules loaded: ${state.rules.length} (allow ${ruleCounts(state.rules).allow} · deny ${ruleCounts(state.rules).deny} · ask ${ruleCounts(state.rules).ask})`];
  if (groups.length === 0) {
    lines.push("(no config files found — all six scopes absent)");
    return lines;
  }
  for (const group of groups) {
    lines.push(`${group.file}  [${group.scope}]`);
    if (group.rules.length === 0) lines.push("  (no rules from this file)");
    for (const rule of group.rules) lines.push(ruleLine(rule));
  }
  return lines;
}

export function renderIssuesSection(state: DiagnosticsState): string[] {
  if (state.issues.length === 0) return [`Invalid specs: 0 — every parsed spec is valid`];
  const lines = [`Invalid specs: ${state.issues.length} (warned + counted, never silently skipped)`];
  for (const issue of state.issues) {
    lines.push(`  ${issue.file ?? "(unknown file)"} [${issue.action}] ${issue.spec}`);
    lines.push(`    → ${issue.message}`);
  }
  return lines;
}

export function renderChildrenSection(state: DiagnosticsState): string[] {
  const lines: string[] = [];
  const agentModes = childAgentModes(state.childrenKeys);
  lines.push(`Inheritance channel: ACTIVE — children spawned from this session inherit the current mode at spawn (snapshot, not live-tracked)`);
  lines.push(`Children currently inherit: ${getModeMeta(state.mode).label} (${state.mode})`);
  if (agentModes && Object.keys(agentModes).length > 0) {
    lines.push(`Per-agent overrides (children.agentModes — beat inheritance):`);
    for (const [agent, mode] of Object.entries(agentModes)) lines.push(`  ${agent}: ${String(mode)}`);
  } else {
    lines.push(`Per-agent overrides (children.agentModes): none configured`);
  }
  lines.push(`Fallback floor: rules-on-bypass (deny + ask-fail-closed + safety floor; no inherited mode received)`);
  lines.push(`Ask degradation: children cannot prompt — ask decisions fail closed with a surface-to-parent reason`);
  return lines;
}

/** `children.agentModes` if it is a string-valued object; undefined otherwise. */
export function childAgentModes(
  childrenKeys: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const modes = childrenKeys?.agentModes;
  if (modes === null || typeof modes !== "object" || Array.isArray(modes)) return undefined;
  return modes as Record<string, unknown>;
}

export function renderHotReloadSection(state: DiagnosticsState): string[] {
  const lines = [
    `Hot-reload: ${state.watchedDirs.length > 0 ? "ACTIVE" : "INACTIVE"}`,
    `Last load: ${state.loadedAt}`,
    `Pending change: ${state.reloadPending ? "yes — applies on the next tool call" : "no"}`,
  ];
  if (state.watchedDirs.length > 0) {
    lines.push(`Watching ${state.watchedDirs.length} directories:`);
    for (const dir of state.watchedDirs) lines.push(`  ${dir}`);
  } else {
    lines.push(`(children run without watchers — per-spawn processes read fresh state at startup)`);
  }
  lines.push(`Rule/config edits clear the session ask-cache on reload (a removed rule must not keep honoring old approvals)`);
  return lines;
}

export function diagnosticsSections(state: DiagnosticsState): DiagnosticsSection[] {
  return [
    { key: "mode", title: "🧭 Mode", lines: renderModeSection(state) },
    { key: "rules", title: "📜 Rules by source", lines: renderRulesSection(state) },
    { key: "issues", title: "⚠️ Invalid specs", lines: renderIssuesSection(state) },
    { key: "children", title: "👥 Children (subagents)", lines: renderChildrenSection(state) },
    { key: "hot-reload", title: "🔁 Hot-reload", lines: renderHotReloadSection(state) },
  ];
}

/** The `All` view: every section concatenated with headers. */
export function renderAll(state: DiagnosticsState): string[] {
  const lines: string[] = [];
  for (const section of diagnosticsSections(state)) {
    lines.push(`── ${section.title} ──`);
    lines.push(...section.lines);
  }
  return lines;
}
