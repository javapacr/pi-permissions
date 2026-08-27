/**
 * WebFetch domain rule matching (FS1) — Claude semantics per the researcher
 * artifact (ccperms.md §3, "WebFetch" row):
 *
 * - Matched against the request hostname, case-insensitive, trailing "." stripped.
 * - `domain:example.com` matches the apex ONLY.
 * - `domain:*.example.com` matches subdomains at any depth, NOT the apex.
 *   The leading-dot form `.example.com` (accepted for parity with older
 *   Claude configs) is treated as `*.example.com`.
 * - Wildcards are dot-bounded: `example.*` matches `example.org` but not
 *   `example.evil.com` (a `*` never spans a dot).
 * - `WebFetch(domain:a.com,b.com)` — comma-separated list, any match wins.
 * - `domain:*` matches every hostname.
 */

/** Normalize one domain entry: strip `domain:` prefix, lowercase, trim. */
export function normalizeDomain(raw: string): string {
	let d = raw.trim().toLowerCase();
	if (d.startsWith("domain:")) d = d.slice(7).trim();
	return d.replace(/\.$/, "");
}

/** Translate one normalized domain pattern to an anchored RegExp. */
export function domainToRegex(domain: string): RegExp {
	const d = normalizeDomain(domain);
	if (d === "" || d === "*" || d === ".*") return /^.+$/;

	// Leading `*.` / `.` — subdomains at any depth, apex excluded.
	if (d.startsWith("*.") || d.startsWith(".")) {
		const rest = d.replace(/^(\*\.)|\./, "");
		if (rest === "" || rest === "*") return /^(?:[^.]+\.)+.+$/;
		return new RegExp(`^(?:[^.]+\\.)+${restSegments(rest)}$`);
	}
	return new RegExp(`^${restSegments(d)}$`);
}

/** Translate dot-separated segments; a segment containing `*` stays dot-bounded. */
function restSegments(d: string): string {
	return d
		.split(".")
		.map((segment) => (segment.includes("*") ? "[^.]*" : segment.replace(/[\\^$.|+()*?{}[\]]/g, "\\$&")))
		.join("\\.");
}

/** True when `hostname` satisfies any of the rule's domain patterns. */
export function matchDomainRule(domains: string[], hostname: string | undefined): boolean {
	if (hostname === undefined) return false;
	const host = hostname.trim().toLowerCase().replace(/\.$/, "");
	if (host === "") return false;
	return domains.some((domain) => domainToRegex(domain).test(host));
}
