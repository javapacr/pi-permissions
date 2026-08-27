/**
 * REFERENCE ONLY — grafted from javapacr/pi-claude-permissions-bridge (MIT).
 * Not compiled, not imported by the extension. Reworked/superseded in FS1
 * per docs/pi-permissions-backlog.md. Keep verbatim for provenance.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiRule } from "./converter.ts";

function matchRule(rule: PiRule, toolName: string, input: Record<string, any>): boolean {
  if (rule.toolName !== toolName) return false;

  if (rule.matchType === "exact-tool" || rule.matchType === "tool-name") {
    return rule.pattern === null; // always matches if tool matches
  }

  if (rule.matchType === "command") {
    const cmd = (input.command as string) ?? "";
    return rule.pattern?.test(cmd) ?? false;
  }

  if (rule.matchType === "url-domain") {
    try {
      const url = new URL(input.url as string);
      return rule.pattern?.test(url.hostname) ?? false;
    } catch {
      return false;
    }
  }

  return false;
}

export function registerEnforcer(pi: ExtensionAPI, rules: PiRule[]) {
  // Session-level approval cache: "toolName:command" → approved
  const sessionApprovals = new Set<string>();

  pi.on("tool_call", async (event, ctx) => {
    const { toolName, input } = event;

    for (const rule of rules) {
      if (!matchRule(rule, toolName, input)) continue;

      if (rule.action === "deny") {
        return { block: true, reason: `Blocked by Claude policy: ${rule.original}` };
      }

      if (rule.action === "ask") {
        const cacheKey = `${toolName}:${JSON.stringify(input)}`;
        if (sessionApprovals.has(cacheKey)) return undefined;

        const label = toolName === "bash"
          ? `Command: ${input.command}`
          : `Tool: ${toolName}`;

        const choice = await ctx.ui.select(
          `⚠️  Permission check\nRule: ask — ${rule.original}\n${label}\n\nAllow?`,
          ["Allow", "Block"]
        );

        if (choice === "Allow") {
          sessionApprovals.add(cacheKey);
          return undefined;
        }
        return { block: true, reason: `Blocked by user (ask rule: ${rule.original})` };
      }

      if (rule.action === "allow") {
        return undefined;
      }
    }

    // No rule matched — pass through
    return undefined;
  });
}
