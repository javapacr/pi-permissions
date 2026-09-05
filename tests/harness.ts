/**
 * Shared harness for factory-driven FS2/FS3 tests: boots the real extension
 * against a stub pi with fully hermetic env (HOME, PI_CODING_AGENT_DIR,
 * PI_SUBAGENT_CHILD — this builder process itself runs with PI_SUBAGENT_CHILD=1,
 * so the default is an explicit delete), seeded config files, and a scripted
 * ui.select.
 *
 * Every test must `dispose()` in finally (env + temp dirs restored).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { FSWatcher, WatchListener } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  /** Extra env vars for the boot (FS4: PI_SUBAGENT_EXTENSION_BINDINGS, PI_SUBAGENT_CHILD_AGENT). */
  env?: Record<string, string>;
  /** Fake fs.watch — FS5 hot-reload tests fire events deterministically. */
  fakeWatch?: boolean;
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
    BINDINGS: process.env.PI_SUBAGENT_EXTENSION_BINDINGS,
    CHILD_AGENT: process.env.PI_SUBAGENT_CHILD_AGENT,
    ...Object.fromEntries(Object.keys(opts.env ?? {}).map((key) => [key, process.env[key]])),
  };
  process.env.HOME = home;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.PI_SUBAGENT_CHILD;
  if (opts.child) process.env.PI_SUBAGENT_CHILD = "1";
  // Hermetic child-side inputs regardless of the host session's own env
  // (this builder process may itself be a pi-subagents child).
  delete process.env.PI_SUBAGENT_EXTENSION_BINDINGS;
  delete process.env.PI_SUBAGENT_CHILD_AGENT;
  for (const [key, value] of Object.entries(opts.env ?? {})) process.env[key] = value;

  const dialogs: Dialog[] = [];
  const fakeWatch = opts.fakeWatch ? makeFakeWatch() : undefined;
  const notifications: Notification[] = [];
  const statuses: Status[] = [];
  /** pi.sendMessage recordings (intercom-turn injection tests). */
  const sentMessages: Array<{ message: Record<string, unknown>; options?: Record<string, unknown> }> = [];
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
    sendMessage: (message: Record<string, unknown>, options?: Record<string, unknown>) => {
      sentMessages.push({ message, options });
    },
  };

  const makeCtx = (hasUI: boolean) => ({ ui, hasUI, cwd });

  let booted: Promise<void> | undefined;
  const ensureBooted = () => (booted ??= extension(stubPi as never, fakeWatch ? { watchFn: fakeWatch.fn } : {}));

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
    sentMessages,

    sessionStart: async () => {
      await ensureBooted();
      return handlers.get("session_start")!({}, makeCtx(true));
    },
    beforeAgentStart: async () => {
      await ensureBooted();
      return handlers.get("before_agent_start")!({}, makeCtx(true));
    },
    /** Fire the turn_start event as pi-core would (turnIndex 0 = first turn of a run). */
    turnStart: async (turnIndex = 0) => {
      await ensureBooted();
      return handlers.get("turn_start")!({ type: "turn_start", turnIndex, timestamp: Date.now() }, makeCtx(true));
    },
    /** Write a pi-subagents agent definition into <cwd>/.pi/agents (project scope). */
    writeAgentDef: (file: string, frontmatter: Record<string, string>) => {
      const dir = join(cwd, ".pi", "agents");
      mkdirSync(dir, { recursive: true });
      const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
      writeFileSync(join(dir, file), `---\n${lines.join("\n")}\n---\n\nAgent body.\n`);
    },

    toolCall: async (toolName: string, input: Record<string, unknown>, hasUI = true) => {
      await ensureBooted();
      return handlers.get("tool_call")!({ toolName, input, toolCallId: `t${++seq}` }, makeCtx(hasUI));
    },
    cycleMode: async () => {
      await ensureBooted();
      await shortcutHandlers.get("ctrl+shift+m")!(makeCtx(true));
    },
    /** Write a file under cwd (mid-session config mutation for FS5 tests). */
    write: (rel: string, content: string) => {
      const target = join(cwd, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    },
    permissionsCommand: async (hasUI = true) => {
      await ensureBooted();
      await commandHandlers.get("permissions")!([], makeCtx(hasUI));
    },

    /** Fire a fake watcher event on a directory (fakeWatch boots only). */
    fireWatchEvent: (dir: string, filename: string | null) => {
      if (!fakeWatch) throw new Error("fireWatchEvent requires fakeWatch: true");
      fakeWatch.fire(dir, filename);
    },
    fakeWatchHandles: fakeWatch?.handles,

    dispose: () => {
      handlers.get("session_shutdown")?.({}, { ui, hasUI: false, cwd });
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value !== undefined) process.env[key] = value;
        else delete process.env[key];
      }
      rmSync(home, { recursive: true, force: true });
      rmSync(agentDir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

export type Harness = ReturnType<typeof boot>;

/** Fake fs.watch handle + trigger surface for deterministic FS5 tests. */
export type FakeWatchHandle = {
  file: string;
  listener: WatchListener<string>;
  closed: boolean;
  onError?: (err: Error) => void;
  error(err: Error): void;
  close(): void;
  on(event: string, cb: (err: Error) => void): void;
};

export function makeFakeWatch() {
  const handles: FakeWatchHandle[] = [];
  const fn = (file: string, listener: WatchListener<string>): FSWatcher => {
    // Faithful to node:fs — watch() throws for nonexistent paths (the
    // ConfigWatcher catches and skips; re-sync retries later).
    if (!existsSync(file)) throw Object.assign(new Error(`ENOENT: no such file or directory, watch '${file}'`), { code: "ENOENT" });
    const handle: FakeWatchHandle = {
      file,
      listener,
      closed: false,
      error(err: Error) {
        handle.onError?.(err);
      },
      close() {
        handle.closed = true;
      },
      on(_event: string, cb: (err: Error) => void) {
        handle.onError = cb;
      },
    };
    handles.push(handle);
    return handle as never;
  };
  const fire = (dir: string, filename: string | null) => {
    for (const handle of handles) {
      if (!handle.closed && (handle.file === dir || handle.file === `${dir}/`)) {
        handle.listener("rename", filename);
      }
    }
  };
  return { fn, handles, fire };
}

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
