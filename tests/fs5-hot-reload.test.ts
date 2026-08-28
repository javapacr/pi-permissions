/**
 * FS5 acceptance: config hot-reload.
 *
 * Two layers:
 * - ConfigWatcher unit tests against fake watch/exists fns: the
 *   WatchListener (eventType, filename) arity trap, basename filtering,
 *   missing-directory ancestor fallback, error paths, stop/sync lifecycle —
 *   no real fs.
 * - Factory tests with the harness's fakeWatch: the real factory loop
 *   (watch event → dirty → next tool_call reloads rules + registry, clears
 *   the session cache, re-syncs watchers, refreshes status counts) driven
 *   deterministically by firing kernel-faithful events (dir-creation on the
 *   watched ancestor, content events on the watched directory). Real
 *   fs.watch is NOT exercised here — the builder sandbox fails every
 *   fs.watch with EMFILE (which would mask regressions via the error-dirty
 *   path); the node:fs glue is pinned by the unit tests instead, and
 *   live-watch behavior is the orchestrator's harness-tab probe.
 */

import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import type { FSWatcher, WatchListener } from "node:fs";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { ConfigWatcher } from "../watch.ts";
import type { ExistsFn, WatchFn } from "../watch.ts";
import { withHarness } from "./harness.ts";
import type { Harness } from "./harness.ts";

const bash = (command: string) => ({ command });
const piDir = (h: Harness) => join(h.cwd, ".pi");

// ---------------------------------------------------------------------------
// ConfigWatcher unit tests (fake watch + exists fns — no real filesystem)
// ---------------------------------------------------------------------------

type FakeHandle = {
  file: string;
  listener: WatchListener<string>;
  onError?: (err: Error) => void;
  closed: boolean;
  close(): void;
  on(event: string, cb: (err: Error) => void): void;
};

function makeFakeWatch(existingDirs: Set<string>) {
  const handles: FakeHandle[] = [];
  const fn = ((file: string, listener: WatchListener<string>): FSWatcher => {
    if (!existingDirs.has(file)) throw Object.assign(new Error(`ENOENT: watch '${file}'`), { code: "ENOENT" });
    const handle: FakeHandle = {
      file,
      listener,
      closed: false,
      close() {
        handle.closed = true;
      },
      on(event, cb) {
        if (event === "error") handle.onError = cb;
      },
    };
    handles.push(handle);
    return handle as never;
  }) as WatchFn;
  const existsFn: ExistsFn = (path: string) => existingDirs.has(path);
  return { fn, existsFn, handles, existingDirs };
}

test("WATCHER: dirty on watched basename in watched dir; unrelated names ignored", () => {
  const fake = makeFakeWatch(new Set(["/proj", "/proj/.pi"]));
  const watcher = new ConfigWatcher(fake.fn, fake.existsFn);
  watcher.sync(["/proj/.pi/permissions.json"]);
  assert.deepEqual(watcher.watchedDirs, ["/proj/.pi"]);
  fake.handles[0]!.listener("rename", "permissions.json");
  assert.equal(watcher.isDirty(), true);
  watcher.clearDirty();
  fake.handles[0]!.listener("rename", "unrelated.txt");
  assert.equal(watcher.isDirty(), false);
});

test("WATCHER: listener arity — filename is the SECOND arg (eventType trap)", () => {
  const fake = makeFakeWatch(new Set(["/proj", "/proj/.pi"]));
  const watcher = new ConfigWatcher(fake.fn, fake.existsFn);
  watcher.sync(["/proj/.pi/permissions.json"]);
  // A single-arg adapter bug binds filename to "rename"/"change"; this pins
  // the correct (eventType, filename) handling.
  fake.handles[0]!.listener("change", "permissions.json");
  assert.equal(watcher.isDirty(), true);
  watcher.clearDirty();
  fake.handles[0]!.listener("rename", "rename");
  assert.equal(watcher.isDirty(), false, "an event TYPE name must never count as a basename");
});

test("WATCHER: filename-less events are conservatively dirty", () => {
  const fake = makeFakeWatch(new Set(["/proj", "/proj/.pi"]));
  const watcher = new ConfigWatcher(fake.fn, fake.existsFn);
  watcher.sync(["/proj/.pi/permissions.json"]);
  fake.handles[0]!.listener("rename", null);
  assert.equal(watcher.isDirty(), true);
});

test("WATCHER: missing dir falls back to nearest existing ancestor, watching its creation", () => {
  // `.claude` missing; /proj missing too — nearest existing ancestor is "/".
  const fake = makeFakeWatch(new Set(["/", "/proj/.pi"]));
  const watcher = new ConfigWatcher(fake.fn, fake.existsFn);
  watcher.sync(["/proj/.claude/settings.json", "/proj/.pi/permissions.json"]);
  assert.equal(fake.handles.length, 2);
  assert.deepEqual(watcher.watchedDirs, ["/", "/proj/.pi"]);

  const ancestor = fake.handles.find((h) => h.file === "/")!;
  ancestor.listener("rename", ".claude"); // the missing dir gets created
  assert.equal(watcher.isDirty(), true);
  watcher.clearDirty();
  ancestor.listener("rename", "settings.json");
  assert.equal(watcher.isDirty(), false, "ancestor only fires on the missing dir's own basename");

  // Directory created since → re-sync opens the direct watcher.
  fake.existingDirs.add("/proj/.claude");
  watcher.sync(["/proj/.claude/settings.json", "/proj/.pi/permissions.json"]);
  const direct = fake.handles.find((h) => h.file === "/proj/.claude")!;
  assert.ok(direct, "re-sync opens the now-existing directory");
  direct.listener("rename", "settings.json");
  assert.equal(watcher.isDirty(), true);
});

test("WATCHER: error closes the watcher, marks dirty, and a sync re-opens it", () => {
  const fake = makeFakeWatch(new Set(["/proj", "/proj/.pi"]));
  const watcher = new ConfigWatcher(fake.fn, fake.existsFn);
  watcher.sync(["/proj/.pi/permissions.json"]);
  const first = fake.handles[0]!;
  first.onError!(new Error("EMFILE"));
  assert.equal(first.closed, true);
  assert.equal(watcher.isDirty(), true, "dying watcher must not go silent");
  watcher.clearDirty();
  watcher.sync(["/proj/.pi/permissions.json"]);
  const second = fake.handles[1]!;
  assert.notEqual(second, first);
  second.listener("rename", "permissions.json");
  assert.equal(watcher.isDirty(), true);
});

test("WATCHER: stop() closes everything and later events are ignored; sync restarts", () => {
  const fake = makeFakeWatch(new Set(["/proj", "/proj/.pi"]));
  const watcher = new ConfigWatcher(fake.fn, fake.existsFn);
  watcher.sync(["/proj/.pi/permissions.json"]);
  const handle = fake.handles[0]!;
  watcher.stop();
  assert.equal(handle.closed, true);
  handle.listener("rename", "permissions.json");
  assert.equal(watcher.isDirty(), false, "stopped watcher ignores events");
  watcher.sync(["/proj/.pi/permissions.json"]);
  fake.handles[1]!.listener("rename", "permissions.json");
  assert.equal(watcher.isDirty(), true);
});

test("WATCHER: sync merges basenames per directory into one watcher", () => {
  const fake = makeFakeWatch(new Set(["/proj", "/proj/.pi"]));
  const watcher = new ConfigWatcher(fake.fn, fake.existsFn);
  watcher.sync(["/proj/.pi/permissions.json"]);
  watcher.sync(["/proj/.pi/mcp.json"]); // same dir, new file
  assert.equal(fake.handles.length, 1, "one watcher per directory");
  fake.handles[0]!.listener("rename", "mcp.json");
  assert.equal(watcher.isDirty(), true, "later-synced basename in same dir is watched");
});

test("WATCHER: two missing dirs sharing an ancestor merge into one ancestor watcher", () => {
  const fake = makeFakeWatch(new Set(["/proj"]));
  const watcher = new ConfigWatcher(fake.fn, fake.existsFn);
  watcher.sync(["/proj/.pi/permissions.json", "/proj/.claude/settings.json"]);
  assert.equal(fake.handles.length, 1, "both fall back to /proj");
  assert.equal(fake.handles[0]!.file, "/proj");
  fake.handles[0]!.listener("rename", ".pi");
  assert.equal(watcher.isDirty(), true);
  watcher.clearDirty();
  fake.handles[0]!.listener("rename", ".claude");
  assert.equal(watcher.isDirty(), true);
});

// ---------------------------------------------------------------------------
// Factory hot-reload tests (fakeWatch — deterministic, kernel-faithful events)
// ---------------------------------------------------------------------------

/**
 * Fire the event the kernel would deliver for writing `rel` under cwd:
 * a content event on the file's directory when that directory is watched,
 * else a dir-creation event (the missing dir's basename) on the ancestor
 * that watches for it.
 */
const fireWrite = (h: Harness, rel: string) => {
  const file = join(h.cwd, rel);
  const dir = dirname(file);
  const direct = h.fakeWatchHandles!.some((w) => !w.closed && w.file === dir);
  h.fireWatchEvent(direct ? dir : h.cwd, direct ? basename(file) : basename(dir));
};

test("HOT: deny rule added mid-session blocks from the next call (no restart)", async () => {
  await withHarness({ fakeWatch: true }, async (h) => {
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined, "pre-change call passes");

    h.write(".pi/permissions.json", JSON.stringify({ permissions: { deny: ["Bash(echo *)"] } }));
    fireWrite(h, ".pi/permissions.json");
    const verdict = await h.toolCall("bash", bash("echo hi"));
    assert.equal(verdict?.block, true, "seeded deny applies on the very next call (bare boot: .pi created now)");
    assert.match(verdict!.reason, /Denied by rule Bash\(echo \*\)/);
    assert.equal(h.dialogs.length, 0, "bypass mode: deny never prompts");
  });
});

test("HOT: removing the deny frees the call again", async () => {
  await withHarness({ fakeWatch: true, projectConfig: { permissions: { deny: ["Bash(echo *)"] } } }, async (h) => {
    await h.sessionStart();
    assert.equal((await h.toolCall("bash", bash("echo hi")))?.block, true);

    h.write(".pi/permissions.json", JSON.stringify({ permissions: {} }));
    fireWrite(h, ".pi/permissions.json");
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined, "removed deny frees the call");
  });
});

test("HOT: invalid JSON mid-write does not crash (scope degrades to absent)", async () => {
  await withHarness({ fakeWatch: true, projectConfig: { permissions: { deny: ["Bash(echo *)"] } } }, async (h) => {
    await h.sessionStart();
    assert.equal((await h.toolCall("bash", bash("echo hi")))?.block, true);

    h.write(".pi/permissions.json", "{ not json [[[ ");
    fireWrite(h, ".pi/permissions.json");
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined, "unparsable file = absent scope, deny gone, no crash");
  });
});

test("HOT: deleting the rule file does not crash and drops its rules", async () => {
  await withHarness({ fakeWatch: true, projectConfig: { permissions: { deny: ["Bash(echo *)"] } } }, async (h) => {
    await h.sessionStart();
    assert.equal((await h.toolCall("bash", bash("echo hi")))?.block, true);

    rmSync(join(h.cwd, ".pi", "permissions.json"));
    fireWrite(h, ".pi/permissions.json");
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
  });
});

test("HOT: a permissions.local.json appearing after startup is watched and honored", async () => {
  // The "Always"-persist scenario: `.pi/` exists (project scope lives in it)
  // but the local file does not — created later, the directory watcher sees it.
  await withHarness({ fakeWatch: true, projectConfig: { permissions: {} } }, async (h) => {
    await h.sessionStart();
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);

    h.write(".pi/permissions.local.json", JSON.stringify({ permissions: { deny: ["Bash(echo *)"] } }));
    fireWrite(h, ".pi/permissions.local.json");
    assert.equal((await h.toolCall("bash", bash("echo hi")))?.block, true, "appearing local file is honored");
  });
});

test("HOT: hot reload clears the session ask-cache (removed approvals don't linger)", async () => {
  await withHarness(
    {
      fakeWatch: true,
      flags: { "permission-mode": "default" },
      projectConfig: { permissions: { ask: ["Bash(echo *)"] } },
    },
    async (h) => {
      h.choices.push("Allow for session");
      await h.sessionStart();
      assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
      assert.equal(h.dialogs.length, 1);
      assert.equal(await h.toolCall("bash", bash("echo hi")), undefined);
      assert.equal(h.dialogs.length, 1, "session allow: no re-prompt without a reload");

      // Any watched-file change triggers a reload (which clears the cache);
      // the ask rule stays in force, so the next call must prompt again.
      h.write(".pi/permissions.json", JSON.stringify({
        permissions: { ask: ["Bash(echo *)"], deny: ["Bash(ls *)"] },
      }));
      fireWrite(h, ".pi/permissions.json");
      await h.toolCall("read", { path: `${h.cwd}/x` }); // free probe: reload happens here
      h.choices.push("Deny");
      const verdict = await h.toolCall("bash", bash("echo hi"));
      assert.equal(h.dialogs.length, 2, "cache cleared — the ask rule prompts again after reload");
      assert.equal(verdict?.block, true);
    },
  );
});

test("HOT: mcp.json change rebuilds the registry (new server tool matched by new rule)", async () => {
  await withHarness(
    { fakeWatch: true, mcpConfig: { mcpServers: { mempalace: { directTools: ["mempalace_search"] } } } },
    async (h) => {
      await h.sessionStart();
      // Pre-change: registry has no atlassian server → no canonical name →
      // no rule can match; bypass passes it.
      assert.equal(await h.toolCall("jira_search", { query: "x" }), undefined);

      writeFileSync(
        join(h.agentDir, "mcp.json"),
        JSON.stringify({ mcpServers: { mempalace: { directTools: ["mempalace_search"] }, atlassian: { directTools: ["jira_search"] } } }),
      );
      h.fireWatchEvent(h.agentDir, "mcp.json"); // agentDir is watched directly (exists at boot)
      h.write(".pi/permissions.json", JSON.stringify({ permissions: { deny: ["mcp__atlassian__jira_search"] } }));
      fireWrite(h, ".pi/permissions.json");

      const verdict = await h.toolCall("jira_search", { query: "x" });
      assert.equal(verdict?.block, true, "registry rebuild must map jira_search → mcp__atlassian__jira_search (then deny)");
      assert.match(verdict!.reason, /mcp__atlassian__jira_search/);
    },
  );
});

test("HOT: status bar carries rule counts by action + issue warnings (separate slot)", async () => {
  await withHarness(
    {
      projectConfig: {
        permissions: {
          allow: ["Bash(echo *)", "Read(src/**)", "Write(/x)"], // Write(path) spec → counted issue
          deny: ["Bash(curl *)"],
          ask: ["WebFetch(domain:example.com)"],
        },
      },
    },
    async (h) => {
      await h.sessionStart();
      const rulesStatus = h.statuses.find((s) => s.key === "permissions-rules");
      assert.ok(rulesStatus, "rules-count status key must exist");
      assert.equal(rulesStatus!.text, "π 2a·1d·1q ⚠1", "2 valid allows (Write spec rejected → issue)");
      assert.equal(h.statuses.at(-1)?.key, "permissions", "mode status stays the last write");
    },
  );
});

test("HOT: status counts update after a mid-session rule change", async () => {
  await withHarness({ fakeWatch: true }, async (h) => {
    await h.sessionStart();
    const rulesStatus = () => h.statuses.filter((s) => s.key === "permissions-rules").at(-1)?.text;
    assert.equal(rulesStatus(), "π 0a·0d·0q");

    h.write(".pi/permissions.json", JSON.stringify({ permissions: { deny: ["Bash(echo *)"] } }));
    fireWrite(h, ".pi/permissions.json");
    await h.toolCall("read", { path: `${h.cwd}/x` });
    assert.equal(rulesStatus(), "π 0a·1d·0q");
    assert.equal(h.statuses.at(-1)?.text, "⏵⏵⏵⏵ Bypass Permissions", "mode slot unchanged by a rule edit");
  });
});

test("HOT: watcher re-sync after a reload picks up a directory created late", async () => {
  // `.claude/` absent at startup → watched via the ancestor; after any
  // reload-triggering change the re-sync opens it directly.
  await withHarness({ fakeWatch: true }, async (h) => {
    await h.sessionStart();
    const claudeDir = join(h.cwd, ".claude");
    assert.ok(!h.fakeWatchHandles!.some((w) => w.file === claudeDir), "no direct watcher before the dir exists");

    h.write(".claude/settings.json", JSON.stringify({ permissions: { allow: ["Bash(git status)"] } })); // creates the dir
    h.write(".pi/permissions.json", JSON.stringify({ permissions: { deny: ["Bash(echo *)"] } }));
    fireWrite(h, ".pi/permissions.json");
    await h.toolCall("read", { path: `${h.cwd}/x` }); // reload + re-sync
    assert.ok(h.fakeWatchHandles!.some((w) => w.file === claudeDir), "late-created dir watched after re-sync");
  });
});

test("HOT: children never hot-reload (per-spawn snapshot semantics)", async () => {
  await withHarness({ fakeWatch: true, child: true }, async (h) => {
    await h.sessionStart();

    h.write(".pi/permissions.json", JSON.stringify({ permissions: { deny: ["Bash(echo *)"] } }));
    fireWrite(h, ".pi/permissions.json"); // even a (spurious) event must not reload child rules
    assert.equal(await h.toolCall("bash", bash("echo hi")), undefined, "child keeps its startup snapshot");
    assert.ok(!h.registrations.shortcuts.includes("ctrl+shift+m"), "child registers no shortcut");
  });
});

test("HOT: session_shutdown stops all watchers", async () => {
  await withHarness({ fakeWatch: true }, async (h) => {
    await h.sessionStart();
    const open = h.fakeWatchHandles!.filter((w) => !w.closed);
    assert.ok(open.length > 0, "watchers running during the session");
    h.dispose();
    assert.ok(h.fakeWatchHandles!.every((w) => w.closed), "dispose (session_shutdown) closes every watcher");
  });
});
