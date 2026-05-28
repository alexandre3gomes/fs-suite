#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# FS Suite — push working state to remote dev environment
#
# Snapshots the current working tree (tracked + untracked files)
# and force-pushes it to refs/heads/dev on origin. Uses git
# plumbing (write-tree + commit-tree) so:
#   - HEAD does not move
#   - the active branch history stays clean
#   - pre-commit hooks do not run (this is a transient deploy,
#     not a reviewable commit)
#
# After the push, triggers ./sync.sh on the remote WSL host to
# rebuild deps, run migrations, and bring the stack up. Finally
# ensures an SSH tunnel localhost:$API_PORT -> WSL:$API_PORT is
# alive — needed so Google OAuth redirect URIs (registered as
# http://localhost:3001/...) continue to land on the remote API.
#
# Configuration (env vars):
#   WINDEV_HOST   SSH host (alias) for the WSL dev box
#                                              (default: dev-server)
#   REMOTE_PATH   Project path relative to $HOME on WSL
#                                              (default: fs-suite)
#
# First-time bootstrap on the WSL box:
#   git clone <repo> ~/fs-suite
#   cd ~/fs-suite && ./scripts/dev-remote/sync.sh
#
# Usage:
#   ./scripts/dev-remote/push.sh
#   WINDEV_HOST=192.168.1.10 ./scripts/dev-remote/push.sh
# ──────────────────────────────────────────────────────────────

set -euo pipefail

WINDEV_HOST=${WINDEV_HOST:-dev-server}
REMOTE_PATH=${REMOTE_PATH:-fs-suite}

cd "$(git rev-parse --show-toplevel)"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "→ snapshot working tree  (branch: $CURRENT_BRANCH)"

# Stage everything (tracked modifications + untracked files) into
# the index so write-tree captures the full working state.
git add -A

TREE=$(git write-tree)
COMMIT_MSG="wip(dev): $TIMESTAMP [from $CURRENT_BRANCH]"
COMMIT=$(echo "$COMMIT_MSG" | git commit-tree "$TREE" -p HEAD)

# Restore the index back to HEAD — leaves the working tree alone
# but un-stages everything we touched above.
git reset --quiet

echo "→ push $COMMIT → origin/dev (force)"
git push --force origin "$COMMIT:refs/heads/dev"

echo "→ upload sync.sh"
# Mirror the local sync.sh to the remote BEFORE invoking it. Two
# reasons: (1) first push, the script doesn't exist on the WSL yet;
# (2) keeps the remote sync.sh in lockstep with the laptop, so changes
# to it take effect immediately without needing a prior dev push.
# Doing it this way (instead of fetch+reset inline) lets sync.sh itself
# capture the pre-pull hashes correctly for change detection.
ssh "$WINDEV_HOST" "mkdir -p $REMOTE_PATH/scripts/dev-remote"
scp -q "$(git rev-parse --show-toplevel)/scripts/dev-remote/sync.sh" \
  "$WINDEV_HOST:$REMOTE_PATH/scripts/dev-remote/sync.sh"

echo "→ trigger sync on $WINDEV_HOST"
# bash -lc forces a login shell so nvm / pnpm / asdf PATH exports
# from ~/.profile or ~/.bash_profile are loaded — non-interactive
# SSH sessions skip ~/.bashrc.
ssh "$WINDEV_HOST" "bash -lc 'cd $REMOTE_PATH && ./scripts/dev-remote/sync.sh'"

# Resolve API port from apps/api/.env so the tunnel matches whatever
# the API is listening on. Fallback 3001 matches the .env.example.
API_PORT=$(grep -E '^PORT=' apps/api/.env 2>/dev/null | cut -d= -f2 | tr -d '"' || true)
API_PORT=${API_PORT:-3001}

echo "→ ensure tunnel  (localhost:$API_PORT → $WINDEV_HOST:$API_PORT)"
# Idempotent: if a tunnel for this exact port + host is already
# running, leave it alone. Otherwise start one in the background
# (-f forks after auth, -N skips remote command — pure forwarding).
if pgrep -f "ssh.*-L $API_PORT:localhost:$API_PORT.*$WINDEV_HOST" >/dev/null; then
  echo "  ↳ already up"
else
  ssh -fN -L "$API_PORT:localhost:$API_PORT" "$WINDEV_HOST"
  echo "  ↳ started"
fi

echo "✓ dev environment updated"
