/**
 * FS4 — pi-subagents child-side mode machinery (D8 inheritance).
 *
 * The parent injects its resolved permission-mode snapshot into the
 * `subagent` tool call's `input.extensionBindings` under the namespace
 * `pi-permissions/1`; pi-subagents encodes that field as the
 * `PI_SUBAGENT_EXTENSION_BINDINGS` env var in the spawned child process
 * (verified live 2026-08-28: readable at child extension load time — the
 * Step-0 probe in ~/.pi/tmp/fs4-step0/). Children read it once at startup
 * (snapshot semantics, never live-tracked).
 *
 * Per-agent overrides (D8): `permissionMode` in the spawning agent's
 * definition-file frontmatter, or `children.agentModes` in pi-permissions
 * config, beat the inherited snapshot — resolved identically on both sides
 * (parent pre-injection, child post-decode) so the chain is idempotent and
 * still works when the parent session does not run this extension.
 *
 * Missing/undecodable inheritance → rules-on-bypass floor (the FS2 baseline).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { getModeMeta, isValidMode } from "./modes.ts";
import type { PermissionMode } from "./modes.ts";
import type { CanonicalTarget, ParsedRule } from "./types.ts";
import { getPiAgentDir } from "./canonicalize.ts";

/** pi-subagents' per-spawn extension-bindings channel (Step-0 verified). */
export const EXTENSION_BINDINGS_ENV = "PI_SUBAGENT_EXTENSION_BINDINGS";
/** pi-subagents sets this to the spawning agent's name when one is given. */
export const CHILD_AGENT_ENV = "PI_SUBAGENT_CHILD_AGENT";
/** Our namespace in the extensionBindings channel (package.name/1 syntax). */
export const BINDINGS_NAMESPACE = "pi-permissions/1";

export type EnvLike = Record<string, string | undefined>;

/**
 * Decode the inherited mode from the extensionBindings env var.
 * Any decode/validation failure → undefined (caller falls to the floor).
 */
export function readInheritedMode(env: EnvLike = process.env): PermissionMode | undefined {
  const raw = env[EXTENSION_BINDINGS_ENV];
  if (!raw) return undefined;
  try {
    const decoded = JSON.parse(raw) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return undefined;
    const mode = (decoded as Record<string, unknown>)[BINDINGS_NAMESPACE];
    if (!mode || typeof mode !== "object" || Array.isArray(mode)) return undefined;
    const value = (mode as Record<string, unknown>)["mode"];
    return isValidMode(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export interface AgentOverrideInput {
  /** Agent name from the spawn (input.agent / PI_SUBAGENT_CHILD_AGENT). */
  agentName: string | undefined;
  cwd: string;
  /** pi-permissions `children` config key (loader `keys.children`). */
  children?: Record<string, unknown>;
  /** Injected for tests; defaults mirror pi-subagents' discovery layout. */
  home?: string;
  agentDir?: string;
  /** Extra dirs to scan FIRST (tests inject temp agent-definition dirs). */
  extraDirs?: string[];
}

function validModeOrUndefined(value: unknown): PermissionMode | undefined {
  return isValidMode(value) ? value : undefined;
}

/** `children.agentModes` map lookup (config beats frontmatter). */
function configAgentMode(children: Record<string, unknown> | undefined, agentName: string): PermissionMode | undefined {
  if (!children || typeof children !== "object") return undefined;
  const map = children["agentModes"];
  if (!map || typeof map !== "object" || Array.isArray(map)) return undefined;
  return validModeOrUndefined((map as Record<string, unknown>)[agentName]);
}

/** Minimal frontmatter block parse → Record of top-level scalar keys. */
function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  const block = end === -1 ? content.slice(3) : content.slice(3, end);
  const fields: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (match) fields[match[1]!] = match[2]!.trim();
  }
  return fields;
}

function fileMatchesAgent(filePath: string, content: string, agentName: string): boolean {
  const stem = filePath.split(sep).pop()!.replace(/\.md$/i, "");
  if (stem === agentName) return true;
  const fm = parseFrontmatter(content);
  if (fm["name"] === agentName) return true;
  const aliases = (fm["aliases"] ?? fm["alias"] ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  return aliases.includes(agentName);
}

/**
 * Agent-definition dirs in resolution order (project first — mirrors
 * pi-subagents' precedence where project definitions override user ones,
 * which override builtins). The project walk approximates
 * findConfiguredProjectRoot's nearest-root default policy: nearest
 * `.pi/agents` (preferred) then legacy `.agents`, walking up, stopping at
 * home. User: `~/.agents` (new) then `<agentDir>/agents` (legacy — honors
 * PI_CODING_AGENT_DIR). Builtin: the shared npm store copy of pi-subagents.
 */
export function agentOverrideDirs(input: AgentOverrideInput): string[] {
  const home = input.home ?? homedir();
  const dirs: string[] = [];
  const push = (dir: string) => {
    if (!dirs.includes(dir)) dirs.push(dir);
  };

  for (const extra of input.extraDirs ?? []) push(extra);

  let dir = input.cwd;
  for (;;) {
    push(join(dir, ".pi", "agents"));
    push(join(dir, ".agents"));
    if (dir === home || dirname(dir) === dir) break;
    dir = dirname(dir);
  }

  push(join(home, ".agents"));
  push(join(getPiAgentDirSafe(input.agentDir), "agents"));
  push(join(getPiAgentDirSafe(input.agentDir), "npm", "node_modules", "pi-subagents", "agents"));

  return dirs.filter((d) => existsSync(d));
}

function getPiAgentDirSafe(explicit: string | undefined): string {
  if (explicit) return explicit;
  try {
    return getPiAgentDir();
  } catch {
    return join(homedir(), ".pi", "agent");
  }
}

/**
 * `permissionMode` frontmatter override for the named agent: first
 * matching definition file (in precedence order) whose frontmatter carries
 * a valid mode. Unknown keys are inert to pi-subagents itself.
 */
export function frontmatterAgentMode(input: AgentOverrideInput): PermissionMode | undefined {
  if (!input.agentName) return undefined;
  for (const dir of agentOverrideDirs(input)) {
    // Prefer the canonical <name>.md, then scan the dir (name/aliases may
    // live in a differently-named file). Definition dirs are small.
    const candidates: string[] = [join(dir, `${input.agentName}.md`)];
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.toLowerCase().endsWith(".md")) {
          const full = join(dir, entry);
          if (!candidates.includes(full)) candidates.push(full);
        }
      }
    } catch {
      // unreadable dir → skip
    }
    for (const filePath of candidates) {
      let content: string;
      try {
        content = readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      if (!fileMatchesAgent(filePath, content, input.agentName)) continue;
      const mode = validModeOrUndefined(parseFrontmatter(content)["permissionMode"]);
      if (mode) return mode;
    }
  }
  return undefined;
}

/**
 * Effective spawn-mode resolution (identical on parent and child side):
 * config `children.agentModes` > agent frontmatter `permissionMode` >
 * inherited snapshot > rules-on-bypass floor.
 */
export function resolveChildMode(
  input: AgentOverrideInput & { inherited?: PermissionMode | undefined },
): PermissionMode {
  if (input.agentName) {
    const configured = configAgentMode(input.children, input.agentName);
    if (configured) return configured;
    const frontmatter = frontmatterAgentMode(input);
    if (frontmatter) return frontmatter;
  }
  return input.inherited ?? "bypassPermissions";
}

/** Reason when an ask-rule (or ask decision) fail-closes in a child. */
export function childAskReason(
  target: CanonicalTarget,
  matchedRule: ParsedRule | undefined,
  mode: PermissionMode,
): string {
  return `Permission required: ${target.spec} (ask rule ${matchedRule?.spec ?? "?"}; `
    + `parent session mode: ${getModeMeta(mode).label} — subagent sessions cannot prompt). `
    + `Surface this request to the parent session in your final result.`;
}

/** Reason when the inherited mode's baseline fail-closes in a child. */
export function childModeReason(target: CanonicalTarget, mode: PermissionMode): string {
  return `Blocked by child permission policy: ${target.spec} requires approval under the `
    + `parent session's ${getModeMeta(mode).label} mode (subagent sessions cannot prompt). `
    + `Surface this request to the parent session in your final result.`;
}

/**
 * Merge our mode snapshot into a `subagent` tool-call input's
 * extensionBindings (parent-side injection). Preserves foreign namespaces;
 * our namespace is always overwritten (the model must not be able to
 * pre-grant itself a mode). Never throws — spawn capability must not
 * depend on injection succeeding.
 */
export function injectModeBinding(
  input: Record<string, unknown> | undefined,
  mode: PermissionMode,
): void {
  if (!input || typeof input !== "object") return;
  try {
    const existing = input["extensionBindings"];
    const base = existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
    input["extensionBindings"] = { ...base, [BINDINGS_NAMESPACE]: { mode } };
  } catch {
    // frozen/sealed input — injection is best-effort
  }
}
