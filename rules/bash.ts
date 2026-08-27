/**
 * Bash/PowerShell rule matching (FS1) — Claude semantics per the researcher
 * artifact (ccperms.md §3, "Bash" row):
 *
 * - `*` matches any text incl. spaces, at any position.
 * - Trailing ` *` or `:*` = word-boundary prefix: `Bash(npm run *)` matches
 *   `npm run build`, `npm run test -- --watch` AND bare `npm run`, but
 *   `Bash(ls *)` does NOT match `lsof`.
 * - `Bash(ls*)` (star glued to the word) matches `lsof` too — pure prefix.
 * - No `*` = exact full-string match.
 * - Wrapper stripping + piecewise compound approval are phase 2 (parking lot);
 *   FS1 matches the full command text.
 */

/** Translate a Claude bash glob into an anchored RegExp. */
export function bashGlobToRegex(glob: string): RegExp {
	if (glob === "*") return /^.*$/;

	// Trailing ` *` or `:*`: word-boundary prefix. Mid-pattern stars stay greedy `.*`.
	const boundaryMatch = glob.match(/^(.*)(?::\*| \*)$/s);
	if (boundaryMatch && boundaryMatch[1] !== undefined && glob.length > 2) {
		return new RegExp(`^${escapeGlob(boundaryMatch[1])}(?:\\s.*)?$`);
	}

	return new RegExp(`^${escapeGlob(glob)}$`);
}

/** Escape regex metacharacters except `*`, which becomes `.*` (any text incl. spaces). */
function escapeGlob(glob: string): string {
	return glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
}

/** True when `command` matches the Claude bash glob `pattern`. */
export function matchBashRule(
	pattern: string,
	command: string,
	opts?: { caseInsensitive?: boolean },
): boolean {
	if (pattern === "*") return true;
	const flags = opts?.caseInsensitive ? "i" : undefined;
	const regex = flags
		? new RegExp(bashGlobToRegex(pattern).source, flags)
		: bashGlobToRegex(pattern);
	return regex.test(command.trim());
}
