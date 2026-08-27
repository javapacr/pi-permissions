/**
 * Always-on safety floor: catastrophic patterns, critical `rm -rf`,
 * protectedPaths — including read gating (the never-gated-read hole the
 * backlog fixes). Runs before modes and cannot be overridden.
 * TODO(FS3) — filled by the safety port; see
 * docs/pi-permissions-backlog.md §FS3.
 */
export type SafetyVerdict = {
  blocked: boolean;
  reason?: string;
};

export function checkSafety(
  _toolName: string,
  _input: Record<string, unknown>,
  _cwd: string,
): SafetyVerdict {
  throw new Error("pi-permissions: checkSafety is implemented in FS3");
}
