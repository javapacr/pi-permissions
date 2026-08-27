/**
 * Gitignore-style path matching for Read/Edit/Write rules (`//`, `~/`,
 * `/`-anchored, bare = any depth, `**`). TODO(FS1) — filled by the
 * rule-engine core; see docs/pi-permissions-backlog.md §FS1.
 */
export function matchPathRule(_pattern: string, _targetPath: string, _cwd: string): boolean {
  throw new Error("pi-permissions: matchPathRule is implemented in FS1");
}
