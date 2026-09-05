/**
 * Mode definitions (FS2, D1/D2/D4): the 4-mode set — plan mode deleted
 * (stays with pi-plan-tools/plannotator); custom modes deleted with the
 * zackify legacy config reader (no config surface carries them; D6 keys are
 * defaultMode/protectedPaths/productionSupport/children —
 * production-support's readOnlyBash covers the investigation use case).
 *
 * Skeleton pieces (Shift+Tab cycling, mode labels/status) are ported from
 * @zackify/pi-claude-permissions v1.0.6 (MIT, © 2026 Zach); see NOTICE.
 */

export type PermissionMode = string;

export interface ModeDefinition {
 id: PermissionMode;
 label: string;
 description: string;
 status: string;
}

export const DEFAULT_MODE: PermissionMode = "bypassPermissions";

export const BUILT_IN_MODES: ModeDefinition[] = [
 {
  id: "default",
  label: "Default",
  description: "Ask before non-read tools; reads free",
  status: "⏵",
 },
 {
  id: "acceptEdits",
  label: "Accept Edits",
  description: "Allow write/edit silently; confirm the rest",
  status: "⏵⏵",
 },
 {
  id: "production-support",
  label: "Production Support",
  description:
   "Investigation mode: reads + safelisted read-only bash free; everything else prompts",
  status: "🛡",
 },
 {
  id: "bypassPermissions",
  label: "Bypass Permissions",
  description: "Allow everything except deny/ask rules and the safety floor",
  status: "⏭",
 },
];

/** Shift+Tab cycle order (D1): default → acceptEdits → production-support → bypass. */
export const SHIFT_TAB_ORDER: PermissionMode[] = [
 "default",
 "acceptEdits",
 "production-support",
 "bypassPermissions",
];

/** D2 investigation framing, injected via before_agent_start on mode entry. */
export const PRODUCTION_SUPPORT_MESSAGE = `[PRODUCTION SUPPORT MODE]
Production environment — investigation mode. Reads are free; every bash/write/edit/MCP/webfetch call prompts for approval.

Do not mutate anything without explicit approval. Prefer read-only commands (commands safelisted via productionSupport.readOnlyBash run freely). Report findings before acting.`;

export const PRODUCTION_SUPPORT_ENDED_MESSAGE = `[PRODUCTION SUPPORT MODE ENDED]
The user toggled out of production support mode. You may now proceed using the active permission mode.`;

export function stringOrUndefined(value: unknown): string | undefined {
 return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function stringArrayOrUndefined(value: unknown): string[] | undefined {
 if (!Array.isArray(value)) return;
 const strings = value.filter(
  (item): item is string => typeof item === "string" && item.length > 0,
 );
 return strings.length > 0 ? strings : undefined;
}

/** True when `mode` is one of the 4 built-in modes. */
export function isValidMode(mode: unknown): mode is PermissionMode {
 return typeof mode === "string" && BUILT_IN_MODES.some((m) => m.id === mode);
}

/** Unknown/absent mode → fallback (never throws; plan/custom modes are gone). */
export function normalizeMode(
 mode: unknown,
 fallback: PermissionMode = DEFAULT_MODE,
): PermissionMode {
 return isValidMode(mode) ? mode : fallback;
}

export function getModeMeta(mode: PermissionMode): ModeDefinition {
 return (
  BUILT_IN_MODES.find((m) => m.id === mode) ??
  BUILT_IN_MODES.find((m) => m.id === DEFAULT_MODE)!
 );
}
