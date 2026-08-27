/**
 * REFERENCE ONLY — grafted from javapacr/pi-claude-permissions-bridge (MIT).
 * Not compiled, not imported by the extension. Reworked/superseded in FS1
 * per docs/pi-permissions-backlog.md. Keep verbatim for provenance.
 */
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface ClaudePermissions {
  allow: string[];
  deny: string[];
  ask: string[];
}

function loadFile(path: string): ClaudePermissions | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const perms = raw?.permissions ?? {};
    return {
      allow: perms.allow ?? [],
      deny: perms.deny ?? [],
      ask: perms.ask ?? [],
    };
  } catch {
    return null;
  }
}

export function loadClaudePermissions(cwd: string): { permissions: ClaudePermissions; sources: string[] } {
  const globalPath = join(homedir(), ".config", "claude", "settings.json");
  const projectPath = join(cwd, ".claude", "settings.json");

  const global = loadFile(globalPath);
  const project = loadFile(projectPath);

  const sources: string[] = [];
  if (global) sources.push(globalPath);
  if (project) sources.push(projectPath);

  // Merge: project extends global, deny always wins
  const merged: ClaudePermissions = {
    allow: [...(global?.allow ?? []), ...(project?.allow ?? [])],
    deny: [...(global?.deny ?? []), ...(project?.deny ?? [])],
    ask: [...(global?.ask ?? []), ...(project?.ask ?? [])],
  };

  // Deduplicate
  merged.allow = [...new Set(merged.allow)];
  merged.deny = [...new Set(merged.deny)];
  merged.ask = [...new Set(merged.ask)];

  // Remove from allow/ask anything that appears in deny (deny wins)
  const denySet = new Set(merged.deny);
  merged.allow = merged.allow.filter(r => !denySet.has(r));
  merged.ask = merged.ask.filter(r => !denySet.has(r));

  return { permissions: merged, sources };
}
