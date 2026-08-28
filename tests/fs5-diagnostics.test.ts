/**
 * FS5 acceptance: /permissions doctor-style diagnostics.
 *
 * Pure-render snapshot tests (rules with provenance, issues with file +
 * message, mode + origin, children policy, hot-reload state) and factory
 * tests driving the real command handler through the stub UI (picker keeps
 * the 4 modes primary; Diagnostics is the trailing option; paged select
 * navigation with esc = back/exit).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODE_ORIGIN_LABELS,
  childAgentModes,
  diagnosticsSections,
  groupRulesBySource,
  renderAll,
  renderChildrenSection,
  renderHotReloadSection,
  renderIssuesSection,
  renderModeSection,
  renderRulesSection,
  ruleCounts,
  rulesStatusText,
} from "../diagnostics.ts";
import type { DiagnosticsState } from "../diagnostics.ts";
import type { ParsedRule, RuleIssue } from "../types.ts";
import { withHarness } from "./harness.ts";

const rule = (action: ParsedRule["action"], spec: string, sources: string[], tool = "Bash", family: ParsedRule["family"] = "bash"): ParsedRule => ({
  action,
  spec,
  family,
  tool,
  sources,
});

const fixture = (): DiagnosticsState => ({
  mode: "production-support",
  modeOrigin: "shortcut",
  rules: [
    rule("allow", "Bash(git status)", ["/proj/.pi/permissions.json"]),
    rule("deny", "Bash(curl *)", ["/proj/.pi/permissions.json", "/proj/.pi/permissions.local.json"]),
    rule("ask", "WebFetch(domain:example.com)", ["/home/u/.config/claude/settings.json"], "WebFetch", "webfetch"),
  ],
  issues: [
    { spec: "Write(/x)", action: "allow", file: "/proj/.pi/permissions.json", message: "Write(path) specs are rejected — Edit governs Edit+Write" },
  ],
  sources: [
    { file: "/home/u/.config/claude/settings.json", scope: "claude-global" },
    { file: "/proj/.pi/permissions.json", scope: "pi-project" },
    { file: "/proj/.pi/permissions.local.json", scope: "pi-local" },
  ],
  childrenKeys: { agentModes: { worker: "bypassPermissions", oracle: "default" } },
  watchedDirs: ["/home/u/.pi", "/proj/.pi"],
  reloadPending: false,
  loadedAt: "2026-08-28T12:00:00.000Z",
});

// ---------------------------------------------------------------------------
// Pure rendering
// ---------------------------------------------------------------------------

test("DIAG: ruleCounts + rulesStatusText (compact status form)", () => {
  const state = fixture();
  assert.deepEqual(ruleCounts(state.rules), { allow: 1, deny: 1, ask: 1 });
  assert.equal(rulesStatusText(state.rules, state.issues), "π 1a·1d·1q ⚠1");
  assert.equal(rulesStatusText(state.rules, []), "π 1a·1d·1q");
  assert.equal(rulesStatusText([], []), "π 0a·0d·0q");
});

test("DIAG: rules grouped by primary source with multi-file provenance", () => {
  const groups = groupRulesBySource(fixture());
  assert.deepEqual(groups.map((g) => g.scope), ["Claude user (global)", "pi project", "pi local"]);
  const piProject = groups[1]!;
  assert.deepEqual(piProject.rules.map((r) => r.spec), ["Bash(git status)", "Bash(curl *)"]);

  const lines = renderRulesSection(fixture());
  assert.ok(lines[0]!.includes("Rules loaded: 3"));
  assert.ok(lines.some((l) => l.includes("/proj/.pi/permissions.json  [pi project]")));
  assert.ok(lines.some((l) => l.trimStart().startsWith("deny") && l.includes("Bash(curl *)") && l.includes("(+1 more source)")), "deduped rule carries provenance annotation");
  assert.ok(lines.some((l) => l.includes("(no rules from this file)")), "empty scope group is explicit");
});

test("DIAG: issues listed with file, action, spec, message + count header", () => {
  const lines = renderIssuesSection(fixture());
  assert.equal(lines[0], "Invalid specs: 1 (warned + counted, never silently skipped)");
  assert.ok(lines.some((l) => l.includes("/proj/.pi/permissions.json [allow] Write(/x)")));
  assert.ok(lines.some((l) => l.includes("→ Write(path) specs are rejected")));
  assert.equal(renderIssuesSection({ ...fixture(), issues: [] })[0], "Invalid specs: 0 — every parsed spec is valid");
});

test("DIAG: mode section shows active mode, origin, cycle key, description", () => {
  const lines = renderModeSection(fixture());
  assert.ok(lines[0]!.includes("Production Support"));
  assert.ok(lines[1]!.includes(MODE_ORIGIN_LABELS.shortcut));
  assert.ok(lines[2]!.includes("ctrl+shift+m"));
  assert.ok(lines[3]!.includes("Investigation mode"));
});

test("DIAG: children section — inheritance channel, current inheritance, agentModes", () => {
  const lines = renderChildrenSection(fixture());
  assert.ok(lines.some((l) => l.includes("Inheritance channel: ACTIVE")));
  assert.ok(lines.some((l) => l.includes("Children currently inherit: Production Support")));
  const overrides = lines.findIndex((l) => l.includes("Per-agent overrides"));
  assert.ok(overrides >= 0);
  assert.ok(lines.slice(overrides).some((l) => l.includes("worker: bypassPermissions")));
  assert.ok(lines.slice(overrides).some((l) => l.includes("oracle: default")));
  assert.ok(lines.some((l) => l.includes("fail closed")));

  const noOverrides = renderChildrenSection({ ...fixture(), childrenKeys: undefined });
  assert.ok(noOverrides.some((l) => l.includes("Per-agent overrides (children.agentModes): none configured")));
});

test("DIAG: childAgentModes accepts only string-valued objects", () => {
  assert.deepEqual(childAgentModes({ agentModes: { worker: "bypassPermissions" } }), { worker: "bypassPermissions" });
  assert.equal(childAgentModes({ agentModes: ["nope"] }), undefined);
  assert.equal(childAgentModes({ agentModes: "worker" }), undefined);
  assert.equal(childAgentModes(undefined), undefined);
});

test("DIAG: hot-reload section — activity, last load, pending, watched dirs, cache policy", () => {
  const lines = renderHotReloadSection(fixture());
  assert.equal(lines[0], "Hot-reload: ACTIVE");
  assert.ok(lines[1]!.includes("Last load: 2026-08-28T12:00:00.000Z"));
  assert.ok(lines.some((l) => l.includes("Pending change: no")));
  assert.ok(lines.some((l) => l.includes("Watching 2 directories:")));
  assert.ok(lines.some((l) => l.includes("clear the session ask-cache")));

  const inactive = renderHotReloadSection({ ...fixture(), watchedDirs: [], reloadPending: true });
  assert.equal(inactive[0], "Hot-reload: INACTIVE");
  assert.ok(inactive.some((l) => l.includes("Pending change: yes")));
  assert.ok(inactive.some((l) => l.includes("children run without watchers")));
});

test("DIAG: sections assembly + All concatenation", () => {
  const sections = diagnosticsSections(fixture());
  assert.deepEqual(sections.map((s) => s.key), ["mode", "rules", "issues", "children", "hot-reload"]);
  const all = renderAll(fixture());
  for (const section of sections) {
    assert.ok(all.includes(`── ${section.title} ──`), `All view must contain ${section.title}`);
  }
});

// ---------------------------------------------------------------------------
// Factory: /permissions picker + diagnostics navigation
// ---------------------------------------------------------------------------

const DIAGNOSTICS_OPTION = "🩺 Diagnostics (mode · rules · issues · children · hot-reload)";

test("PERMS: picker keeps the 4 modes primary with Diagnostics trailing + cycle hint", async () => {
  await withHarness({}, async (h) => {
    await h.sessionStart();
    h.choices.push("Deny"); // not consumed: picker choice comes first
    h.choices.unshift("🩺 Diagnostics (mode · rules · issues · children · hot-reload)");
    await h.permissionsCommand();

    const picker = h.dialogs[0]!;
    assert.match(picker.title, /Select permission mode/);
    assert.match(picker.title, /ctrl\+shift\+m/);
    assert.equal(picker.options.length, 5);
    assert.ok(picker.options.slice(0, 4).every((o, i) => o.startsWith(["Default", "Accept Edits", "Production Support", "Bypass Permissions"][i]!)), "4 modes stay first");
    assert.equal(picker.options[4], DIAGNOSTICS_OPTION, "diagnostics is the trailing option");
  });
});

test("PERMS: diagnostics navigation — section list → section view → esc back → esc exit", async () => {
  await withHarness(
    { projectConfig: { permissions: { deny: ["Bash(curl *)"] } } },
    async (h) => {
      await h.sessionStart();
      h.choices.push(
        DIAGNOSTICS_OPTION,   // picker → diagnostics
        "📜 Rules by source", // section list
        "  deny  Bash(curl *)", // any line — inert; falls back to the section list, whose next select gets no choice (esc) → exit
      );
      await h.permissionsCommand();

      assert.equal(h.dialogs.length, 4, "picker, section list, section view, section list (esc exit)");
      assert.match(h.dialogs[1]!.title, /Permission diagnostics/);
      assert.deepEqual(h.dialogs[1]!.options, [
        "📄 All",
        "🧭 Mode",
        "📜 Rules by source",
        "⚠️ Invalid specs",
        "👥 Children (subagents)",
        "🔁 Hot-reload",
      ]);
      assert.equal(h.dialogs[2]!.title, "📜 Rules by source  (esc = back)");
      assert.ok(h.dialogs[2]!.options.some((l) => l.includes("deny") && l.includes("Bash(curl *)")));
      assert.ok(h.dialogs[2]!.options.some((l) => l.includes(h.cwd)), "rule lines carry the source file");
      assert.ok(h.dialogs[3]!.title.startsWith("Permission diagnostics"), "line selection returns to the section list");
    },
  );
});

test("PERMS: 'All' view renders every section through the live factory state", async () => {
  await withHarness(
    {
      flags: { "permission-mode": "default" },
      projectConfig: { permissions: { allow: ["Bash(echo *)"], ask: ["Write(/x)"] } },
    },
    async (h) => {
      await h.sessionStart();
      h.choices.push(DIAGNOSTICS_OPTION, "📄 All");
      await h.permissionsCommand();

      const all = h.dialogs[2]!;
      assert.equal(all.title, "📄 All  (esc = back)");
      assert.ok(all.options.some((l) => l.includes("Active mode: Default")));
      assert.ok(all.options.some((l) => l.includes("set by --permission-mode flag")), "origin is reported");
      assert.ok(all.options.some((l) => l.includes("Bash(echo *)")));
      assert.ok(all.options.some((l) => l.includes("Invalid specs: 1")), "issue count header surfaced in All");
      assert.ok(all.options.some((l) => l.includes("Write(/x)")), "the invalid spec itself is listed");
      assert.ok(all.options.some((l) => l.includes("Hot-reload: ACTIVE")));
      assert.ok(all.options.some((l) => l.includes(".pi")), "watched dirs listed");
    },
  );
});

test("PERMS: mode origin reflects cycling", async () => {
  await withHarness({}, async (h) => {
    await h.sessionStart();
    await h.cycleMode(); // bypass → default
    h.choices.push(DIAGNOSTICS_OPTION, "🧭 Mode");
    await h.permissionsCommand();
    const modeLines = h.dialogs[2]!.options;
    assert.ok(modeLines.some((l) => l.includes("set by ctrl+shift+m cycling")), modeLines.join("\n"));
  });
});

test("PERMS: headless /permissions stays a warning (diagnostics requires UI)", async () => {
  await withHarness({ flags: { "permission-mode": "default" } }, async (h) => {
    await h.sessionStart();
    await h.permissionsCommand(false);
    assert.ok(h.notifications.some((n) => n.message.includes("/permissions requires interactive UI")));
    assert.equal(h.dialogs.length, 0);
  });
});
