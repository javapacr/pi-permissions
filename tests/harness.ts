/**
 * Shared harness for factory-driven FS2/FS3 tests: boots the real extension
 * against a stub pi with fully hermetic env (HOME, PI_CODING_AGENT_DIR,
 * PI_SUBAGENT_CHILD — this builder process itself runs with PI_SUBAGENT_CHILD=1,
 * so the default is an explicit delete), seeded config files, and a scripted
 * ui.select.
 *
 * Every test must `dispose()` in finally (env + temp dirs restored).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../index.ts";

export type Dialog = { title: string; options: string[] };
export type Notification = { message: string; type?: string };
export type Status = { key: string; text: string | undefined };

export type HarnessOptions = {
  /** JSON written to <cwd>/.pi/permissions.json (pi-project scope). */
  projectConfig?: Record<string, unknown>;
  /** JSON written to <agentDir>/permissions.json (pi-user scope). */
  userConfig?: Record<string, unknown>;
  /** JSON written to <agentDir>/mcp.json (MCP registry input). */
  mcpConfig?: Record<string, unknown>;
  /** getFlag(name) map. */
  flags?: Record<string, unknown>;
  /** Simulate a subagent child session (PI_SUBAGENT_CHILD=1). */
  child?: boolean;
};

export function boot(opts: HarnessOptions = {}) {
  const home = mkdtempSync(join(tmpdir(), "piperm-h-"));
  const agentDir = mkdtempSync(join(tmpdir(), "piperm-a-"));
  const cwd = mkdtempSync(join(tmpdir(), "piperm-c-"));

  if (opts.projectConfig !== undefined) {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "permissions.json"), JSON.stringify(opts.projectConfig, null, 2));
  }
  if (opts.userConfig !== undefined) {
    writeFileSync(join(agentDir, "permissions.json"), JSON.stringify(opts.userConfig, null, 2));
  }
  if (opts.mcpConfig !== undefined) {
    writeFileSync(join(agentDir, "mcp.json"), JSON.stringify(opts.mcpConfig, null, 2));
  }

  const savedEnv = {
    HOME: process.env.HOME,
    AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    CHILD: process.env.PI_SUBAGENT_CHILD,
  };
  process.env.HOME = home;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.PI_SUBAGENT_CHILD;
  if (opts.child) process.env.PI_SUBAGENT_CHILD = "1";

  const dialogs: Dialog[] = [];
  const notifications: Notification[] = [];
  const statuses: Status[] = [];
  const choices: string[] = [];
  const registrations = {
    flags: [] as string[],
    commands: [] as string[],
    shortcuts: [] as string[],
    events: [] as string[],
  };
  const handlers = new Map<string, (event: any, ctx: any) => Promise<any>>();
  const shortcutHandlers = new Map<string, (ctx: any) => Promise<any>>();
  const commandHandlers = new Map<string, (args: any, ctx: any) => Promise<any>>();

  const ui = {
    select: async (title: string, options: string[]): Promise<string | undefined> => {
      dialogs.push({ title, options });
      const choice = choices.shift();
      return typeof choice === "string" ? choice : undefined;
    },
    notify: (message: string, type?: "info" | "warning" | "error") => {
      notifications.push({ message, type });
    },
    setStatus: (key: string, text: string | undefined) => {
      statuses.push({ key, text });
    },
  };

  const stubPi = {
    registerFlag: (name: string, _def: unknown) => {
      registrations.flags.push(name);
    },
    getFlag: (name: string) => opts.flags?.[name],
    registerCommand: (name: string, def: { handler: (args: any, ctx: any) => Promise<void> }) => {
      registrations.commands.push(name);
      commandHandlers.set(name, def.handler);
    },
    registerShortcut: (keys: string, def: { handler: (ctx: any) => Promise<void> }) => {
      registrations.shortcuts.push(keys);
      shortcutHandlers.set(keys, def.handler);
    },
    on: (event: string, handler: (event: any, ctx: any) => Promise<any>) => {
      registrations.events.push(event);
      handlers.set(event, handler);
    },
  };

  const makeCtx = (hasUI: boolean) => ({ ui, hasUI, cwd });

  let booted: Promise<void> | undefined;
  const ensureBooted = () => (booted ??= extension(stubPi as never));

  let seq = 0;
  return {
    home,
    agentDir,
    cwd,
    dialogs,
    notifications,
    statuses,
    choices,
    registrations,

    sessionStart: async () => {
      await ensureBooted();
      return handlers.get("session_start")!({}, makeCtx(true));
    },
    beforeAgentStart: async () => {
      await ensureBooted();
      return handlers.get("before_agent_start")!({}, makeCtx(true));
    },
    toolCall: async (toolName: string, input: Record<string, unknown>, hasUI = true) => {
      await ensureBooted();
      return handlers.get("tool_call")!({ toolName, input, toolCallId: `t${++seq}` }, makeCtx(hasUI));
    },
    cycleMode: async () => {
      await ensureBooted();
      await shortcutHandlers.get("shift+tab")!(makeCtx(true));
    },
    permissionsCommand: async () => {
      await ensureBooted();
      await commandHandlers.get("permissions")!([], makeCtx(true));
    },

    dispose: () => {
      if (savedEnv.HOME !== undefined) process.env.HOME = savedEnv.HOME;
      else delete process.env.HOME;
      if (savedEnv.AGENT_DIR !== undefined) process.env.PI_CODING_AGENT_DIR = savedEnv.AGENT_DIR;
      else delete process.env.PI_CODING_AGENT_DIR;
      if (savedEnv.CHILD !== undefined) process.env.PI_SUBAGENT_CHILD = savedEnv.CHILD;
      else delete process.env.PI_SUBAGENT_CHILD;
      rmSync(home, { recursive: true, force: true });
      rmSync(agentDir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

export type Harness = ReturnType<typeof boot>;

/** try/finally wrapper so env never leaks between tests. */
export async function withHarness(
  opts: HarnessOptions,
  fn: (h: Harness) => Promise<void>,
): Promise<void> {
  const h = boot(opts);
  try {
    await fn(h);
  } finally {
    h.dispose();
  }
}
