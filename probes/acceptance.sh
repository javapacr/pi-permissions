#!/usr/bin/env bash
# pi-permissions acceptance battery — setup/teardown helper for probes/acceptance.md.
# Usage: ./probes/acceptance.sh seed | teardown | status
# The interactive probe steps themselves are run by hand in the probe TUI (see
# probes/acceptance.md §3); this script only manages the seeded files safely.

set -euo pipefail

MONOREPO="/Users/reevonr/Documents/projects/personal/pi-extensions"
PROBE_DIR="$HOME/.pi/tmp/pi-permissions-probe"
RULES="$MONOREPO/.pi/permissions.json"
PROBE_MCP="$PROBE_DIR/mcp.json"
LOCAL_RULES="$MONOREPO/.pi/permissions.local.json"
SCRATCH=("$HOME/.pi/tmp/fs6-scratch.txt" "/tmp/pi-fs6-ps")

seed_rules() {
  if [[ -e "$RULES" ]]; then
    echo "REFUSING: $RULES already exists — remove it first (teardown leftover?)" >&2
    exit 1
  fi
  cat > "$RULES" <<'EOF'
{
  "permissions": {
    "deny": [
      "Bash(curl *)",
      "mcp__mempalace__mempalace_search",
      "Write(/tmp/never)"
    ],
    "ask": ["Bash(git push *)"]
  },
  "productionSupport": { "readOnlyBash": ["git status"] }
}
EOF
  echo "seeded: $RULES"
}

seed_probe_mcp() {
  if [[ -e "$PROBE_MCP" ]]; then
    echo "REFUSING: $PROBE_MCP already exists — remove it first." >&2
    exit 1
  fi
  cat > "$PROBE_MCP" <<'EOF'
{
  "mcpServers": {
    "mempalace": {
      "command": "/Users/reevonr/.local/share/mise/installs/python/3.13/bin/mempalace-mcp",
      "args": [],
      "lifecycle": "lazy",
      "directTools": ["mempalace_search", "mempalace_diary_write", "mempalace_diary_read", "mempalace_reconnect"]
    }
  }
}
EOF
  echo "seeded: $PROBE_MCP"
}

seed() {
  seed_rules
  seed_probe_mcp
  echo
  echo "Launch the probe session (monorepo root):"
  echo "  PI_CODING_AGENT_DIR=$PROBE_DIR pi --no-extensions \\"
  echo "    -e ./pi-permissions \\"
  echo "    -e ~/.pi/agent/npm/node_modules/pi-mcp-adapter \\"
  echo "    -e ~/.pi/agent/npm/node_modules/pi-subagents"
}

teardown() {
  rm -f "$RULES" "$LOCAL_RULES" "$PROBE_MCP" "${SCRATCH[@]}"
  echo "removed: $RULES $LOCAL_RULES $PROBE_MCP ${SCRATCH[*]}"
  echo "kept: $PROBE_DIR/auth.json (deletes at probe-profile retirement — proposes/hygiene.md H4)"
}

status() {
  for f in "$RULES" "$PROBE_MCP" "$LOCAL_RULES"; do
    if [[ -e "$f" ]]; then echo "present: $f"; else echo "absent : $f"; fi
  done
}

cmd="${1:-}"
case "$cmd" in
  seed) seed ;;
  teardown) teardown ;;
  status) status ;;
  *) echo "usage: $0 seed|teardown|status" >&2; exit 2 ;;
esac
