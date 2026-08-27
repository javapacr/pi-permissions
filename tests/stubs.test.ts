import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as canonicalize from "../canonicalize.ts";
import * as loader from "../loader.ts";
import * as bash from "../rules/bash.ts";
import * as paths from "../rules/paths.ts";
import * as webfetch from "../rules/webfetch.ts";
import * as mcp from "../rules/mcp.ts";
import * as agent from "../rules/agent.ts";
import * as safety from "../safety.ts";
import * as ask from "../ask.ts";
import * as persist from "../persist.ts";

const stubs: Array<[string, Record<string, unknown>, string]> = [
  ["canonicalize.canonicalize", canonicalize, "canonicalize"],
  ["loader.loadRules", loader, "loadRules"],
  ["rules/bash.matchBashRule", bash, "matchBashRule"],
  ["rules/paths.matchPathRule", paths, "matchPathRule"],
  ["rules/webfetch.matchDomainRule", webfetch, "matchDomainRule"],
  ["rules/mcp.matchMcpRule", mcp, "matchMcpRule"],
  ["rules/agent.matchAgentRule", agent, "matchAgentRule"],
  ["safety.checkSafety", safety, "checkSafety"],
  ["ask.ask", ask, "ask"],
  ["persist.persistAllowRule", persist, "persistAllowRule"],
];

test("every stub module exports its named function and throws with its fill-FS marker", () => {
  for (const [label, mod, fnName] of stubs) {
    const fn = mod[fnName];
    assert.equal(typeof fn, "function", `${label} must export function ${fnName}`);
    assert.throws(
      () => (fn as (...args: unknown[]) => unknown)(),
      /FS[0-9]/,
      `${label} must throw until its feature set lands`,
    );
  }
});

test("reference/ bridge files exist with provenance headers", () => {
  for (const file of ["converter.ts", "enforcer.ts", "loader.ts"]) {
    const url = new URL(`../reference/${file}`, import.meta.url);
    assert.ok(existsSync(url), `reference/${file} must exist`);
    const text = readFileSync(url, "utf-8");
    assert.ok(
      text.includes("REFERENCE ONLY — grafted from javapacr/pi-claude-permissions-bridge"),
      `reference/${file} must carry the provenance header`,
    );
  }
});
