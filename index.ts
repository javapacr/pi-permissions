/**
 * pi-permissions — Claude-Code-parity permission engine for pi.
 *
 * FS4: pi-subagents enforcement — child mode inheritance (D8 snapshot via
 * input.extensionBindings → PI_SUBAGENT_EXTENSION_BINDINGS, Step-0-verified),
 * per-agent permissionMode overrides, Agent(name) spawn gating in the parent,
 * and the mode-aware child baseline (prompt decisions fail closed with a
 * surface-to-parent reason). FS2+FS3: modes engine + ask UX. Skeleton pieces (flags, Shift+Tab cycling,
 * /permissions dialog, status bar) ported from @zackify/pi-claude-permissions
 * v1.0.6 (MIT, © 2026 Zach — see NOTICE); enforcement is the FS1 rule engine
 * (canonicalize → evaluate) composed with the 4-mode baselines, the always-on
 * safety floor, and the single ask dialog:
 *
 *   canonicalize → safety floor → deny → ask → mode baseline → allow
 *
 * Invariant (D7 + backlog FS2): deny > ask > mode baseline > allow. Ask
 * prompts even in bypass. Allow rules are consulted only where they change
 * the outcome (default mode; acceptEdits for non-edit tools) —
 * production-support skips the allow pass entirely.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { CanonicalTarget, EvalResult, McpRegistry, ParsedRule } from "./types.ts";
import {
  DEFAULT_MODE,
  PRODUCTION_SUPPORT_ENDED_MESSAGE,
  PRODUCTION_SUPPORT_MESSAGE,
  SHIFT_TAB_ORDER,
  BUILT_IN_MODES,
  getModeMeta,
  isValidMode,
  normalizeMode,
} from "./modes.ts";
import type { PermissionMode } from "./modes.ts";
import { loadRules } from "./loader.ts";
import type { LoadedConfig } from "./types.ts";
import { ConfigWatcher, watchedConfigFiles } from "./watch.ts";
import type { WatchFn } from "./watch.ts";
import {
  diagnosticsSections,
  renderAll,
  rulesStatusText,
} from "./diagnostics.ts";
import type { DiagnosticsState, ModeOrigin } from "./diagnostics.ts";
import { buildDefaultMcpRegistry, canonicalize, getPiAgentDir } from "./canonicalize.ts";
import { evaluate } from "./evaluator.ts";
import type { EvaluateOptions } from "./evaluator.ts";
import { DEFAULT_PROTECTED_PATHS, makeSafetyFloor } from "./safety.ts";
import { AskCache, resolveAsk } from "./ask.ts";
import {
  CHILD_AGENT_ENV,
  childAskReason,
  childModeReason,
  injectModeBinding,
  readInheritedMode,
  resolveChildMode,
} from "./child.ts";
import { matchBashRule } from "./rules/bash.ts";
import { parseRuleSpec } from "./rules/parse.ts";

type UiContext = {
  ui: any;
  hasUI?: boolean;
  cwd?: string;
};

/** Free by nature in every non-bypass baseline (no side effects to gate). */
const FREE_PI_TOOLS = new Set(["todo", "ask_user_question"]);

/** Optional production-identical injection points (tests pass fakes). */
export type ExtensionDeps = {
  /** fs.watch replacement — hermetic tests drive events deterministically. */
  watchFn?: WatchFn;
};

export default async function permissionExtension(pi: ExtensionAPI, deps: ExtensionDeps = {}) {
  pi.registerFlag("permission-mode", {
    description: "Permission mode (default, acceptEdits, production-support, bypassPermissions)",
    type: "string",
    default: "",
  });
  pi.registerFlag("dangerously-skip-permissions", {
    description: "Bypass permission prompts (deny/ask rules and the safety floor still apply)",
    type: "boolean",
    default: false,
  });

  const home = homedir();
  const isChild = process.env.PI_SUBAGENT_CHILD === "1";

  // FS4 child-side inheritance inputs, read once at load (snapshot at child
  // startup — never live-tracked). The parent's tool_call hook injected the
  // mode snapshot via input.extensionBindings; pi-subagents carried it into
  // this process's env (Step-0-verified channel).
  const inheritedMode = isChild ? readInheritedMode() : undefined;
  const childAgentName = isChild ? (process.env[CHILD_AGENT_ENV]?.trim() || undefined) : undefined;
  let childMode: PermissionMode = "bypassPermissions"; // floor until resolved

  // Session state — loaded at session_start (lazy fallback in tool_call);
  // FS5 hot-reload re-loads on the next tool call after any watched
  // rule/config/registry file changes (children run without a watcher —
  // per-spawn processes read fresh state at startup, mode snapshot fixed).
  let rules: ParsedRule[] = [];
  let rulesLoaded = false;
  let lastLoaded: LoadedConfig | undefined;
  let registry: McpRegistry | undefined;
  let evaluateOpts: EvaluateOptions = {};
  let readOnlyBash: string[] = [];
  let persistTarget: string | undefined;
  let childrenKeys: Record<string, unknown> | undefined;
  const watcher = new ConfigWatcher(deps.watchFn);
  let lastLoadTime = new Date(0).toISOString();

  let mode: PermissionMode = DEFAULT_MODE;
  let modeOrigin: ModeOrigin = "hard-default";
  const cache = new AskCache();
  let psInjectionPending = false;
  let psEndedPending = false;

  const reloadState = async (cwd: string) => {
    const loaded = await loadRules({ cwd });
    rules = loaded.rules;
    rulesLoaded = true;
    lastLoaded = loaded;
    lastLoadTime = new Date().toISOString();
    registry = buildDefaultMcpRegistry(cwd);
    const protectedPaths = (loaded.keys.protectedPaths ?? DEFAULT_PROTECTED_PATHS).map((path) =>
      path.startsWith("~/") ? resolve(home, path.slice(2)) : resolve(path),
    );
    evaluateOpts = { checkSafety: makeSafetyFloor({ home, protectedPaths, cwd }) };
    readOnlyBash = loaded.keys.productionSupport?.readOnlyBash ?? [];
    persistTarget = loaded.keys.persistTarget;
    childrenKeys = loaded.keys.children;
    return loaded;
  };

  const updateStatus = (ctx: UiContext) => {
    // Rule counts first, mode second — the mode entry stays the LAST status
    // write (existing consumers assert on it; counts are a separate footer slot).
    if (lastLoaded) {
      ctx.ui.setStatus("permissions-rules", rulesStatusText(lastLoaded.rules, lastLoaded.issues));
    }
    const meta = getModeMeta(mode);
    ctx.ui.setStatus("permissions", `${meta.status} ${meta.label}`);
  };

  const applyMode = (nextMode: PermissionMode, ctx: UiContext, origin: ModeOrigin = "shortcut") => {
    const wasPS = mode === "production-support";
    mode = nextMode;
    modeOrigin = origin;
    cache.clear();

    if (nextMode === "production-support" && !wasPS) {
      psInjectionPending = true;
      psEndedPending = false;
      ctx.ui.notify("Production support: investigation mode — mutations require approval", "info");
    } else if (wasPS && nextMode !== "production-support") {
      psEndedPending = true;
      psInjectionPending = false;
      ctx.ui.notify("Production support ended", "info");
    } else {
      ctx.ui.notify(`Permission mode: ${getModeMeta(mode).label}`, "info");
    }

    updateStatus(ctx);
  };

  pi.on("session_start", async (_event, ctx) => {
    const cwd = resolve(ctx.cwd ?? process.cwd());
    const loaded = await reloadState(cwd);
    cache.clear();
    psEndedPending = false;

    if (!isChild) {
      // Flags/config resolve the startup mode (no persistence across
      // restarts; D4 hard default bypassPermissions, defaultMode honored).
      if (pi.getFlag("dangerously-skip-permissions") === true) {
        mode = "bypassPermissions";
        modeOrigin = "flag";
      } else {
        const flagMode = pi.getFlag("permission-mode");
        if (typeof flagMode === "string" && flagMode) {
          if (isValidMode(flagMode)) {
            mode = flagMode;
            modeOrigin = "flag";
          } else {
            mode = normalizeMode(loaded.keys.defaultMode, DEFAULT_MODE);
            modeOrigin = loaded.keys.defaultMode && mode === loaded.keys.defaultMode ? "config" : "hard-default";
            ctx.ui.notify(
              `Unknown --permission-mode "${flagMode}" — using ${getModeMeta(mode).label}`,
              "warning",
            );
          }
        } else {
          mode = normalizeMode(loaded.keys.defaultMode, DEFAULT_MODE);
          modeOrigin = loaded.keys.defaultMode && mode === loaded.keys.defaultMode ? "config" : "hard-default";
        }
      }
    } else {
      // FS4 (D8): children resolve their mode once at startup — per-agent
      // override (children.agentModes config > agent-definition frontmatter
      // permissionMode) beats the inherited snapshot, which beats the
      // rules-on-bypass floor. Flags/defaultMode stay ignored in children.
      childMode = resolveChildMode({
        agentName: childAgentName,
        cwd,
        children: loaded.keys.children,
        inherited: inheritedMode,
        home,
        agentDir: getPiAgentDir(),
      });
    }

    psInjectionPending = !isChild && mode === "production-support";
    if (!isChild) {
      // FS5: watch all six rule/config scopes + the MCP registry inputs;
      // changes mark the watcher dirty and apply from the next tool call.
      watcher.sync(watchedConfigFiles(cwd));
      updateStatus(ctx);
    }
  });

  pi.on("session_shutdown", async () => {
    watcher.stop();
  });

  if (!isChild) {
    // FS5: pi 0.84.3 reserves shift+tab (app.thinking.cycle) and drops
    // extension bindings for it (RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS
    // — the FS4 startup warning). ctrl+shift+m is free in the builtin map;
    // mnemonic: "mode". See README "Keyboard shortcut".
    pi.registerShortcut("ctrl+shift+m", {
      description: `Cycle permission mode (${SHIFT_TAB_ORDER.map((id) => getModeMeta(id).label).join(" → ")})`,
      handler: async (ctx) => {
        const idx = SHIFT_TAB_ORDER.indexOf(mode);
        applyMode(SHIFT_TAB_ORDER[(idx + 1) % SHIFT_TAB_ORDER.length]!, ctx);
      },
    });

    pi.registerCommand("permissions", {
      description: "Select permission mode / view permission diagnostics",
      handler: async (_args, ctx) => {
        if (!ctx.hasUI) {
          ctx.ui.notify("/permissions requires interactive UI", "warning");
          return;
        }

        const options = [
          ...BUILT_IN_MODES.map((m) => `${m.label} — ${m.description}`),
          "🩺 Diagnostics (mode · rules · issues · children · hot-reload)",
        ];
        const selected = await ctx.ui.select("Select permission mode  (cycle: ctrl+shift+m)", options);
        const idx = selected ? options.indexOf(selected) : -1;
        if (idx >= 0 && idx < BUILT_IN_MODES.length) {
          applyMode(BUILT_IN_MODES[idx]!.id, ctx, "picker");
          return;
        }
        if (selected && idx >= BUILT_IN_MODES.length) {
          await showDiagnostics(ctx);
        }
      },
    });
  }

  /** FS5 diagnostics view: paged ui.select navigation (esc = back). */
  const showDiagnostics = async (ctx: UiContext) => {
    const sections = diagnosticsSections(diagnosticsState());
    for (;;) {
      const sectionTitles = ["📄 All", ...sections.map((s) => s.title)];
      const choice = await ctx.ui.select("Permission diagnostics  (esc = close)", sectionTitles);
      if (!choice) return; // esc / cancel
      const lines = choice === "📄 All" ? renderAll(diagnosticsState()) : (sections.find((s) => s.title === choice)?.lines ?? []);
      // Each line becomes an inert option — selection falls through to the
      // section picker; esc anywhere exits the view.
      await ctx.ui.select(`${choice}  (esc = back)`, lines.length > 0 ? lines : ["(empty)"]);
    }
  };

  const diagnosticsState = (): DiagnosticsState => ({
    mode,
    modeOrigin,
    rules: lastLoaded?.rules ?? rules,
    issues: lastLoaded?.issues ?? [],
    sources: lastLoaded?.sources ?? [],
    childrenKeys,
    watchedDirs: watcher.watchedDirs,
    reloadPending: watcher.isDirty(),
    loadedAt: lastLoadTime,
  });

  pi.on("before_agent_start", async () => {
    if (psInjectionPending) {
      psInjectionPending = false;
      return {
        message: {
          customType: "production-support-context",
          content: PRODUCTION_SUPPORT_MESSAGE,
          display: true,
        },
      };
    }

    if (psEndedPending) {
      psEndedPending = false;
      return {
        message: {
          customType: "production-support-ended-context",
          content: PRODUCTION_SUPPORT_ENDED_MESSAGE,
          display: true,
        },
      };
    }
  });

  const denyReason = (verdict: EvalResult): string =>
    `Denied by rule ${verdict.matchedRule?.spec ?? "?"}${verdict.source ? ` (from ${verdict.source})` : ""}.`;

  const isFreeTarget = (target: CanonicalTarget): boolean =>
    target.tool === "Read" || FREE_PI_TOOLS.has(target.piTool);

  const matchesReadOnlyBash = (command: string): boolean =>
    readOnlyBash.some((entry) => {
      const wrapped = entry.match(/^Bash\(([\s\S]*)\)$/i);
      return matchBashRule((wrapped ? wrapped[1] : entry).trim(), command);
    });

  /** The FS3 ask decision point — session cache, dialog, persistence. */
  const askDecision = async (
    target: CanonicalTarget,
    matchedRule: ParsedRule | undefined,
    ctx: UiContext,
  ) => {
    const result = await resolveAsk({
      target,
      matchedRule,
      ctx,
      mode,
      cache,
      home,
      persistTarget,
      onPersist: (spec, file) => {
        // Add the persisted rule to the live set so it takes effect from the
        // next call without a restart (session cache covers this key now).
        const parsed = parseRuleSpec(spec, "allow", { home, anchorDir: ctx.cwd ?? process.cwd(), cwd: ctx.cwd ?? process.cwd() });
        if (parsed.ok) rules.push({ ...parsed.rule, sources: [file] });
      },
    });
    return result.allow ? undefined : { block: true as const, reason: result.reason };
  };

  /**
   * FS4 Agent(name) spawn support: after a `subagent` call is allowed, merge
   * the child's resolved mode snapshot into input.extensionBindings under our
   * namespace (config agentModes > agent frontmatter permissionMode > the
   * parent's CURRENT mode — the D8 snapshot). Non-agent calls pass through
   * untouched. Best-effort: a frozen input never breaks the spawn itself.
   */
  const allowAgentSpawn = (
    input: Record<string, unknown> | undefined,
    target: CanonicalTarget,
    cwd: string,
  ) => {
    if (target.family !== "agent") return;
    const childSpawnMode = resolveChildMode({
      agentName: target.agent,
      cwd,
      children: childrenKeys,
      inherited: mode,
      home,
      agentDir: getPiAgentDir(),
    });
    injectModeBinding(input, childSpawnMode);
  };

  pi.on("tool_call", async (event, ctx) => {
    const cwd = resolve(ctx.cwd ?? process.cwd());
    if (!rulesLoaded) await reloadState(cwd); // defensive: call before session_start

    // FS5 hot-reload: a watched rule/config/registry file changed since the
    // last call — re-read everything (also rebuilds the MCP registry), clear
    // the session ask-cache (a removed rule must not keep honoring old
    // approvals), re-sync watchers (picks up directories created since the
    // last sync), and refresh the status-bar rule counts.
    if (!isChild && watcher.isDirty()) {
      watcher.clearDirty();
      await reloadState(cwd);
      cache.clear();
      watcher.sync(watchedConfigFiles(cwd));
      updateStatus(ctx);
    }

    const target = canonicalize(event.toolName, event.input, { cwd, home, registry });

    if (isChild) {
      // FS4 child baseline: the inherited (or overridden) mode's baseline
      // applies verbatim; every decision that would prompt in the parent
      // fail-closes with a surface-to-parent reason (children have no TUI).
      const verdict = evaluate(rules, target, {
        ...evaluateOpts,
        ignoreAllow: childMode === "production-support",
      });
      if (verdict.action === "deny") {
        return { block: true as const, reason: verdict.safetyReason ?? denyReason(verdict) };
      }
      if (verdict.action === "ask") {
        return { block: true as const, reason: childAskReason(target, verdict.matchedRule, childMode) };
      }
      if (verdict.action === "allow") return;

      // No rule matched — the child mode's baseline decides.
      if (childMode === "bypassPermissions") return;
      if (childMode === "acceptEdits" && (target.tool === "Edit" || target.tool === "Write")) return;
      if (isFreeTarget(target)) return;
      if (childMode === "production-support" && target.family === "bash" && matchesReadOnlyBash(target.command ?? "")) {
        return;
      }
      return { block: true as const, reason: childModeReason(target, childMode) };
    }

    const verdict = evaluate(rules, target, {
      ...evaluateOpts,
      ignoreAllow: mode === "production-support",
    });

    if (verdict.action === "deny") {
      return { block: true as const, reason: verdict.safetyReason ?? denyReason(verdict) };
    }
    if (verdict.action === "ask") {
      const asked = await askDecision(target, verdict.matchedRule, ctx);
      if (!asked) allowAgentSpawn(event.input, target, cwd);
      return asked;
    }
    if (verdict.action === "allow") {
      allowAgentSpawn(event.input, target, cwd);
      return;
    }

    // No rule matched — the mode baseline decides.
    if (mode === "bypassPermissions") {
      allowAgentSpawn(event.input, target, cwd);
      return;
    }
    if (mode === "acceptEdits" && (target.tool === "Edit" || target.tool === "Write")) {
      allowAgentSpawn(event.input, target, cwd);
      return;
    }
    if (isFreeTarget(target)) {
      allowAgentSpawn(event.input, target, cwd);
      return;
    }
    if (mode === "production-support" && target.family === "bash" && matchesReadOnlyBash(target.command ?? "")) {
      allowAgentSpawn(event.input, target, cwd);
      return;
    }
    const asked = await askDecision(target, undefined, ctx);
    if (!asked) allowAgentSpawn(event.input, target, cwd);
    return asked;
  });
}
