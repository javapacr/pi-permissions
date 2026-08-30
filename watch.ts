/**
 * FS5 config hot-reload watcher.
 *
 * Watches the parent DIRECTORIES (not the files) of every rule/config source
 * + MCP registry input: directory watching survives the tmp+rename pattern
 * used by atomic writers (a file-level FSWatcher dies on rename), catches
 * files that appear after startup (a dialog-persisted `.pi/permissions.json`
 * or `<agentDir>/permissions.json`), and sees deletes uniformly. One
 * non-recursive watcher per distinct directory, events filtered by the
 * watched basenames.
 *
 * Directories that do not exist yet are handled by the nearest-existing-
 * ancestor fallback: sync() walks up from a missing directory until it finds
 * one that exists and watches THAT, filtering events on the missing
 * directory's own basename — so the creation of `.pi/` in a bare project
 * fires, and the post-reload re-sync (index.ts re-syncs after every
 * watcher-triggered reload) opens the real directory watcher. For the scoped
 * persist options the rule also reaches the live set directly via
 * the onPersist callback, covering the very next call regardless.
 *
 * Semantics: events only mark the watcher DIRTY — the actual reload happens
 * lazily on the NEXT tool call (index.ts). No timers, no reload storms: an
 * editor writing a file in three syscalls coalesces into one dirty flag, and
 * a transient mid-write state (invalid JSON) is usually gone by the time the
 * next call reads the file (the loader treats an unparsable file as an
 * absent scope — documented behavior, never a crash).
 *
 * WatchListener arity note: node calls the listener as
 * (eventType, filename) — the adapter must take BOTH arguments or `filename`
 * silently binds to the event type ("rename"/"change"); pinned by a unit
 * test.
 *
 * Both the watch function and the existence probe are injectable for
 * hermetic tests.
 */

import type { FSWatcher, WatchListener } from "node:fs";
import { existsSync, watch as nodeWatch } from "node:fs";
import { basename, dirname, join } from "node:path";
import { defaultLoaderPaths } from "./loader.ts";
import { getPiAgentDir } from "./canonicalize.ts";

export type WatchFn = (filename: string, listener: WatchListener<string>) => FSWatcher;
export type ExistsFn = (path: string) => boolean;

/**
 * Every file FS5 watches: the six rule/config scopes (loader) plus the three
 * MCP registry inputs (canonicalize). Registry files share
 * `buildDefaultMcpRegistry`'s read set.
 */
export function watchedConfigFiles(cwd: string): string[] {
  const p = defaultLoaderPaths(cwd);
  const agentDir = getPiAgentDir();
  return [
    p.claudeProject,
    p.claudeLocal,
    p.claudeGlobal,
    p.piUser,
    p.piProject,
    p.piLocal,
    join(agentDir, "mcp.json"),
    join(agentDir, "mcp-cache.json"),
    join(p.cwd, ".pi", "mcp.json"),
  ];
}

/** What one watched directory cares about. */
type WatchSpec = {
  /** Basenames watched directly in this directory. */
  direct: Set<string>;
  /**
   * Basenames of MISSING subdirectories whose creation this directory is
   * watching on behalf of (ancestor fallback) — e.g. `.pi` in a bare cwd.
   */
  ancestors: Set<string>;
};

export class ConfigWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly specs = new Map<string, WatchSpec>();
  private dirtyFlag = false;
  private changeCount = 0;
  private stopped = false;

  private readonly watchFn: WatchFn;
  private readonly existsFn: ExistsFn;

  constructor(watchFn?: WatchFn, existsFn?: ExistsFn) {
    this.watchFn = watchFn ?? ((file, listener) => nodeWatch(file, { encoding: "utf8" }, listener));
    this.existsFn = existsFn ?? existsSync;
  }

  /** True when at least one relevant change has fired since the last clear. */
  isDirty(): boolean {
    return this.dirtyFlag;
  }

  clearDirty(): void {
    this.dirtyFlag = false;
  }

  /** Total relevant events observed (diagnostics/tests only). */
  get changes(): number {
    return this.changeCount;
  }

  /** Directories under active watch, including ancestor fallbacks (diagnostics/tests only). */
  get watchedDirs(): string[] {
    return [...this.watchers.keys()].sort();
  }

  /**
   * Incrementally establish watchers for the given files. Never throws.
   * Directories that exist are watched directly (basenames filtered); missing
   * ones fall back to their nearest existing ancestor, which watches for the
   * missing directory's creation.
   */
  sync(files: string[]): void {
    this.stopped = false;
    for (const file of files) {
      const dir = dirname(file);
      const base = basename(file);
      const target = this.nearestExistingDir(dir);
      const spec = this.specFor(target);
      if (target === dir) spec.direct.add(base);
      else spec.ancestors.add(basename(dir));
    }
    for (const dir of this.specs.keys()) {
      if (this.watchers.has(dir)) continue;
      try {
        const watcher = this.watchFn(
          dir,
          (eventType, filename) => this.onEvent(dir, filename),
        );
        watcher.on?.("error", () => this.onWatcherError(dir, watcher));
        this.watchers.set(dir, watcher);
      } catch {
        // Unwatchable directory — retried on the next sync(); never fatal.
      }
    }
  }

  /** Close every watcher. Safe to call repeatedly; sync() restarts cleanly. */
  stop(): void {
    this.stopped = true;
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close();
      } catch {
        // Already closed — ignore.
      }
    }
    this.watchers.clear();
  }

  private specFor(dir: string): WatchSpec {
    let spec = this.specs.get(dir);
    if (!spec) {
      spec = { direct: new Set(), ancestors: new Set() };
      this.specs.set(dir, spec);
    }
    return spec;
  }

  /** `dir` when it exists, else the closest existing ancestor (root at worst). */
  private nearestExistingDir(dir: string): string {
    let current = dir;
    for (;;) {
      if (this.existsFn(current)) return current;
      const parent = dirname(current);
      if (parent === current) return current; // filesystem root
      current = parent;
    }
  }

  private onEvent(dir: string, filename: string | null): void {
    if (this.stopped) return;
    const spec = this.specs.get(dir);
    // filename-less events are treated conservatively as relevant; named
    // events count when the basename is watched directly here OR is a
    // missing subdirectory this ancestor watches the creation of.
    const relevant =
      filename === null ||
      filename === undefined ||
      (spec !== undefined && (spec.direct.has(filename) || spec.ancestors.has(filename)));
    if (relevant) {
      this.dirtyFlag = true;
      this.changeCount += 1;
    }
  }

  private onWatcherError(dir: string, watcher: FSWatcher): void {
    try {
      watcher.close();
    } catch {
      // ignore
    }
    this.watchers.delete(dir);
    // A watcher dying must not go silent: mark dirty so the next call
    // reloads (and index.ts re-syncs, reopening the watcher if the
    // directory came back).
    this.dirtyFlag = true;
  }
}
