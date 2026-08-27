# reference/ — bridge engine (grafted, non-compiled)

These three files are verbatim copies from `javapacr/pi-claude-permissions-bridge`
(MIT), prepended only with a provenance header:

- `loader.ts` — Claude settings discovery + merge (2 scopes; superseded by the
  FS1 dual-source loader covering 3 Claude + 3 pi scopes, D3/D6/D7).
- `converter.ts` — Claude rule-string → matcher conversion (the grammar sketch
  the FS1 parser replaces; note the silently-skipped unknown specs — a defect
  the backlog explicitly fixes).
- `enforcer.ts` — `tool_call` enforcement + ask prompting (superseded by the
  FS1 evaluator and the FS3 single ask dialog).

Status: **reference only**. They are excluded from TypeScript compilation
(`tsconfig.json` `exclude`) and never imported by live extension code. They
exist so the FS1 rule-engine rework can consult the predecessor implementation
in-repo instead of digging through git history. FS1 supersedes them; they may
be deleted once engine parity is established.
