/**
 * Atomic persistence of "Always allow" rules to `.pi/permissions.local.json`
 * (D5; `persistTarget` config honored). Writes are tmp+rename and
 * hot-reload-visible. TODO(FS3) — see docs/pi-permissions-backlog.md §FS3.
 */
export function persistAllowRule(_rule: string, _cwd: string): void {
  throw new Error("pi-permissions: persistAllowRule is implemented in FS3");
}
