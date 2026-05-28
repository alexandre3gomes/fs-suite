#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# FS Suite — sync remote dev environment with origin/dev
#
# Runs on the WSL dev box. Pulls the latest dev snapshot, reinstalls
# deps only when pnpm-lock changed, applies Prisma migrations only
# when schema.prisma changed, brings Postgres + Redis up via docker
# compose, and (re)starts the API inside a tmux session so logs
# survive SSH disconnect.
#
# Idempotent — safe to run repeatedly. Typically invoked by
# push.sh from the developer's laptop, but can be run manually
# from any SSH session.
#
# Usage:
#   ./scripts/dev-remote/sync.sh
# ──────────────────────────────────────────────────────────────

set -euo pipefail

PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$PROJECT_DIR"

command -v tmux >/dev/null || { echo "✗ tmux not installed (sudo apt install tmux)"; exit 1; }
command -v docker >/dev/null || { echo "✗ docker not installed"; exit 1; }
command -v pnpm >/dev/null || { echo "✗ pnpm not installed"; exit 1; }

echo "→ fetch origin/dev"
git fetch --quiet origin dev
git checkout --quiet dev 2>/dev/null || git checkout --quiet -B dev origin/dev
git reset --hard --quiet origin/dev

# Marker files track what was *last successfully installed/migrated*.
# Compared to the current on-disk file hash, so a first run (no marker)
# or a deleted node_modules both trigger reinstall correctly.
mkdir -p .dev-sync
LOCK_MARKER=.dev-sync/lock.sha
SCHEMA_MARKER=.dev-sync/schema.sha

current_lock=$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)
if [[ ! -d node_modules || ! -f "$LOCK_MARKER" || "$(cat "$LOCK_MARKER")" != "$current_lock" ]]; then
  echo "→ pnpm install"
  pnpm install
  echo "$current_lock" > "$LOCK_MARKER"
fi

echo "→ build shared packages  (types, ui, ...)"
# The API imports compiled output from packages/*/dist. Turbo caches
# so this is a no-op when nothing in packages/ changed.
pnpm turbo build --filter='./packages/*'

echo "→ docker compose up  (postgres + redis)"
docker compose up -d

current_schema=$(sha256sum apps/api/prisma/schema.prisma | cut -d' ' -f1)
if [[ ! -f "$SCHEMA_MARKER" || "$(cat "$SCHEMA_MARKER")" != "$current_schema" ]]; then
  echo "→ prisma migrate deploy + generate"
  pnpm --filter @fs-suite/api exec prisma migrate deploy
  pnpm --filter @fs-suite/api exec prisma generate
  echo "$current_schema" > "$SCHEMA_MARKER"
fi

SESSION="fs-suite-api"
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "→ restart api session  ($SESSION)"
  tmux kill-session -t "$SESSION"
fi
tmux new-session -d -s "$SESSION" "bash -lc \"cd '$PROJECT_DIR' && pnpm --filter @fs-suite/api dev\""

# The API port comes from apps/api/.env (PORT=...); fall back to 3001.
API_PORT=$(grep -E '^PORT=' apps/api/.env 2>/dev/null | cut -d= -f2 | tr -d '"' || true)
API_PORT=${API_PORT:-3001}

# The hostname reachable from the LAN (Mac, etc) is the Windows host's
# name — not the WSL hostname — because mirrored networking shares
# the host's interfaces. WSL_HOST_LAN env var lets you override.
LAN_HOST=${WSL_HOST_LAN:-games-pc}

echo ""
echo "✓ stack up"
echo "   api    → http://$LAN_HOST:$API_PORT"
echo "   logs   → tmux attach -t $SESSION   (Ctrl-b d to detach)"
echo "   stop   → tmux kill-session -t $SESSION && docker compose down"
