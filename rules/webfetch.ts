/**
 * Dot-bounded domain matching for `WebFetch(domain:…)` rules.
 * TODO(FS1) — filled by the rule-engine core; see
 * docs/pi-permissions-backlog.md §FS1.
 */
export function matchDomainRule(_pattern: string, _url: string): boolean {
  throw new Error("pi-permissions: matchDomainRule is implemented in FS1");
}
