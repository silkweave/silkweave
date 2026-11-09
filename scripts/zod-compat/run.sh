#!/usr/bin/env bash
# Consumer-compatibility check for the MCP zod shim (packages/mcp/src/util/schema.ts).
# Packs the BUILT @silkweave/core|auth|mcp, installs them into a throwaway consumer
# project pinned to each zod version in the published range (^3.25 || ^4), and runs
# check.mjs (defaults, coercion, transforms, recursion, structured output) against
# both MCP protocol eras. Run after `pnpm build`. Needs network (npm install).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/tgz"
for pkg in core auth mcp; do
  (cd "$ROOT/packages/$pkg" && pnpm pack --pack-destination "$WORK/tgz" >/dev/null)
done
tgz() { ls "$WORK"/tgz/silkweave-"$1"-*.tgz; }
cat > "$WORK/package.json" <<JSON
{
  "name": "silkweave-zod-compat",
  "private": true,
  "type": "module",
  "dependencies": {
    "@silkweave/core": "file:$(tgz core)",
    "@silkweave/auth": "file:$(tgz auth)",
    "@silkweave/mcp": "file:$(tgz mcp)"
  },
  "overrides": {
    "@silkweave/core": "file:$(tgz core)",
    "@silkweave/auth": "file:$(tgz auth)"
  }
}
JSON
cp "$ROOT/scripts/zod-compat/check.mjs" "$WORK/check.mjs"
cd "$WORK"
status=0
for version in ${ZOD_VERSIONS:-3.25.76 4.0.0 4.1.12 latest}; do
  npm install --silent --no-audit --no-fund "zod@$version" >/dev/null
  echo "== zod $(node -p "require('./node_modules/zod/package.json').version")"
  node check.mjs | grep -E "FAIL|ALL OK|FAILURES" || status=1
done
exit $status
