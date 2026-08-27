/**
 * Agent (subagent tool) rule matching (FS1) — Claude semantics per the
 * researcher artifact (ccperms.md §3, "Agent" row): name-based,
 * `Agent(AgentName)`; no glob documented. Bare `Agent` = any agent
 * (whole-tool form). Matching is exact and case-sensitive; parameter forms
 * like `Agent(model:…)` are parking lot (parser rejects with a warning).
 */

import type { CanonicalTarget } from "../types.ts";

export function matchAgentRule(agentName: string | undefined, target: CanonicalTarget): boolean {
	if (target.family !== "agent") return false;
	if (agentName === undefined) return true;
	return target.agent === agentName;
}
