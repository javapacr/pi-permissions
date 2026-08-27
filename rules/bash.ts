/**
 * Bash rule matching: Claude-style glob → regex plus `:*` suffix semantics
 * (e.g. `Bash(npm run *)` matches `npm run test --watch`).
 * TODO(FS1) — filled by the rule-engine core; see
 * docs/pi-permissions-backlog.md §FS1.
 */
export function matchBashRule(_pattern: string, _command: string): boolean {
  throw new Error("pi-permissions: matchBashRule is implemented in FS1");
}
