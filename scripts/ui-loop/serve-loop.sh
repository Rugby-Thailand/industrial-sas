#!/usr/bin/env bash
# Rebuilds and restarts the production server that loop captures run against
# (http://localhost:3171, dist dir .next-loop). The dev server stays for
# implementers; captures use UI_LOOP_BASE_URL=http://localhost:3171.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.bun/bin:$PATH"
pkill -f 'next start --hostname localhost --port 3171' || true
NEXT_DIST_DIR=.next-loop BUN_OPTIONS=--no-env-file bun run --bun --no-env-file next build --webpack
# next build adds its dist dir to tsconfig.json; keep the tracked file clean.
git diff --quiet -- tsconfig.json || git checkout -- tsconfig.json
NEXT_DIST_DIR=.next-loop BUN_OPTIONS=--no-env-file nohup bun run --bun --no-env-file \
  next start --hostname localhost --port 3171 > output/ui-loop/serve-loop.log 2>&1 &
for _ in $(seq 1 60); do
  curl -sf -o /dev/null http://localhost:3171/th/sign-in && exit 0
  sleep 2
done
echo "loop server did not start; see output/ui-loop/serve-loop.log" >&2
exit 1
