/**
 * Gitignore-style path rule matching for Read/Edit/Write families (FS1) —
 * Claude semantics per the researcher artifact (ccperms.md §3, "Read"/"Edit"
 * rows):
 *
 * Anchors:
 * - `//path`  -> filesystem root (absolute)
 * - `~/path`  -> home directory
 * - `/path`   -> the settings source's anchor directory (loader supplies it)
 * - `path` / `./path` -> current directory; bare names (no `/`) match at ANY
 *   depth (`Read(.env)` ≡ `Read(**\/.env)`).
 *
 * Globs: `*` = one segment, `**` = across segments, `?` = one char, `[...]`
 * classes. Trailing `/**` (or a trailing `/`) also matches the named root
 * itself.
 *
 * Depth asymmetry (Claude): a cwd-relative pattern with a leading literal
 * segment (`Edit(src/**)`) matches only `<cwd>/src/**` as an allow rule, but
 * as deny/ask also matches a `src` directory at any depth. Patterns that
 * already start with `**`/ match any depth for every action.
 *
 * Symlink dual-matching (allow needs link+target, deny blocks if either
 * matches) is phase 2 — not implemented in FS1.
 */

import type { CompiledPath, RuleAction } from "../types.ts";

export type PathCompileContext = {
	home: string;
	/** Anchor directory for `/path` rules — the rule's source scope anchor. */
	anchorDir: string;
	/** Session cwd for cwd-relative patterns. */
	cwd: string;
};

/** Compile a Claude path pattern into a matchable form. */
export function compilePathPattern(
	pattern: string,
	action: RuleAction,
	ctx: PathCompileContext,
): CompiledPath {
	const hadTrailingSlash = /\/$/.test(pattern) && pattern !== "/";
	let body = pattern.replace(/\/+$/, "");
	let anyDepth = false;
	let segments: string[] | null = null; // when set: absolute-anchored full segments
	let relative: string[] | null = null; // when set: relative segments (any-depth form)
	let cwdRelative = false;

	if (body.startsWith("//")) {
		segments = toSegments(body.slice(2));
	} else if (body === "~" || body.startsWith("~/")) {
		const sub = body === "~" ? "" : body.slice(2);
		segments = [...toSegments(ctx.home), ...toSegments(sub)];
	} else if (body.startsWith("/")) {
		segments = [...toSegments(ctx.anchorDir), ...toSegments(body.slice(1))];
	} else if (body.startsWith("**/")) {
		relative = toSegments(body.slice(3));
		anyDepth = true;
	} else if (body.startsWith("./")) {
		relative = toSegments(body.slice(2));
		cwdRelative = true;
	} else if (body.includes("/")) {
		relative = toSegments(body);
		cwdRelative = true;
	} else {
		// Bare name: basename match at any depth.
		relative = toSegments(body);
		anyDepth = true;
	}

	if (cwdRelative && (action === "deny" || action === "ask")) {
		// Deny/ask depth boost: match at any depth instead of only under the cwd.
		anyDepth = true;
	} else if (cwdRelative) {
		// Allow: anchor at the cwd (absolute form).
		segments = [...toSegments(ctx.cwd), ...relative!];
		relative = null;
	}

	let finalSegments: string[];
	if (anyDepth && relative) {
		finalSegments = relative;
	} else if (segments) {
		finalSegments = segments;
	} else {
		finalSegments = relative ?? [];
	}

	// Trailing "/" (directory form) behaves like `dir/**` and also matches the dir.
	if (hadTrailingSlash && finalSegments.length > 0) {
		finalSegments = [...finalSegments, "**"];
	}
	const matchRoot = finalSegments[finalSegments.length - 1] === "**";

	return {
		segments: finalSegments,
		matchers: finalSegments.map(compileSegment),
		anyDepth,
		matchRoot,
	};
}

/** Split a path string into segments, dropping empties (double slashes). */
function toSegments(p: string): string[] {
	return p.split("/").filter((s) => s.length > 0);
}

/** Compile one path segment to a regex; `**` stays a marker. */
function compileSegment(segment: string): RegExp | "**" {
	if (segment === "**") return "**";
	let out = "";
	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i]!;
		if (ch === "*") {
			out += "[^/]*";
		} else if (ch === "?") {
			out += "[^/]";
		} else if (ch === "[") {
			// Character class: copy through to the closing bracket (gitignore syntax).
			let j = i + 1;
			let cls = "[";
			if (segment[j] === "!" || segment[j] === "^") {
				cls += "^";
				j++;
			}
			let closed = false;
			while (j < segment.length && segment[j] !== "]") {
				cls += segment[j];
				j++;
			}
			if (j < segment.length && segment[j] === "]") {
				cls += "]";
				closed = true;
			}
			if (closed && cls.length > 2) {
				out += cls;
				i = j;
				continue;
			}
			out += "\\[";
		} else {
			out += ch.replace(/[\\^$.|+()*?{}[\]]/g, "\\$&");
		}
	}
	return new RegExp(`^${out}$`);
}

/**
 * True when the absolute `targetPath` matches the compiled pattern.
 * `P/**` also matches the named root `P` itself.
 */
export function matchPathRule(compiled: CompiledPath, targetPath: string): boolean {
	const target = targetPath.split("/").filter((s) => s.length > 0);
	if (matchSegments(compiled.matchers, 0, target, 0)) return true;
	if (compiled.matchRoot) {
		// Trailing `**` dropped: the named root itself matches.
		let last = compiled.matchers.length - 1;
		while (last >= 0 && compiled.matchers[last] === "**") last--;
		if (last < 0) return true;
		if (matchSegments(compiled.matchers.slice(0, last + 1), 0, target, 0)) return true;
	}
	if (!compiled.anyDepth) return false;
	for (let start = 1; start <= target.length; start++) {
		if (matchSegments(compiled.matchers, 0, target, start)) return true;
		if (compiled.matchRoot) {
			let last = compiled.matchers.length - 1;
			while (last >= 0 && compiled.matchers[last] === "**") last--;
			if (last >= 0 && matchSegments(compiled.matchers.slice(0, last + 1), 0, target, start)) return true;
		}
	}
	return false;
}

/** Segment-wise glob match with `**` support (recursive). */
function matchSegments(
	matchers: Array<RegExp | "**">,
	patIdx: number,
	target: string[],
	targetIdx: number,
): boolean {
	if (patIdx >= matchers.length) return targetIdx >= target.length;
	const matcher = matchers[patIdx]!;
	if (matcher === "**") {
		for (let skip = targetIdx; skip <= target.length; skip++) {
			if (matchSegments(matchers, patIdx + 1, target, skip)) return true;
		}
		return false;
	}
	if (targetIdx >= target.length) return false;
	if (!matcher.test(target[targetIdx]!)) return false;
	return matchSegments(matchers, patIdx + 1, target, targetIdx + 1);
}
