#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# FS Suite — Bootstrap GitHub Secrets from .env
#
# Reads the canonical .env (your password-manager copy) and pushes
# the subset of values that GitHub Actions workflows need to access
# at workflow time (i.e. NOT through the API).
#
# Out of scope (CI/CD pipeline auth — set those by hand, once):
#   EC2_HOST, EC2_SSH_KEY, EC2_USER, GCP_PROJECT_ID,
#   GCP_WIF_PROVIDER, GCP_WIF_SERVICE_ACCOUNT, GCP_SA_KEY,
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
#   TURBO_TEAM, TURBO_TOKEN.
#
# Prerequisites:
#   - gh CLI installed and authenticated (gh auth status)
#   - .env file with the secrets listed below
#
# Usage:
#   ./infra/bootstrap-github-secrets.sh path/to/.env
#
# Idempotent: re-running overwrites with the current .env values.
# ──────────────────────────────────────────────────────────────

ENV_FILE="${1:-}"

if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "Usage: $0 path/to/.env"
  echo ""
  echo "The .env must contain the secrets listed in"
  echo "infra/README.md (Secrets → Workflow data + Frontend build)."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI not installed. See https://cli.github.com"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh not authenticated. Run: gh auth login"
  exit 1
fi

# Secrets that workflows read directly (NOT via the API).
#
# Each entry is "ENV_VAR_NAME:GH_SECRET_NAME". When the names match,
# you can write just "NAME" (handled by the loop below).
SYNC_LIST=(
  # Workflow data — db-backup.yml + metrics-digest.yml
  "DATABASE_URL"
  "SUPABASE_SERVICE_ROLE_KEY"
  "ADMIN_METRICS_TOKEN"
  # Frontend build — deploy-app.yml injects these at Expo export time.
  # SENTRY_DSN is shared with the backend (same project, separate by SDK
  # tag); POSTHOG_KEY is the public project key (phc_).
  "EXPO_PUBLIC_POSTHOG_KEY:POSTHOG_KEY"
  "SENTRY_DSN"
)

# Load .env without leaking to the parent shell.
read_var() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Target repository: $REPO"
echo ""

PUSHED=0
SKIPPED=0
for entry in "${SYNC_LIST[@]}"; do
  if [[ "$entry" == *":"* ]]; then
    ENV_NAME="${entry%%:*}"
    GH_NAME="${entry##*:}"
  else
    ENV_NAME="$entry"
    GH_NAME="$entry"
  fi

  VALUE=$(read_var "$ENV_NAME")
  if [[ -z "$VALUE" ]]; then
    echo "  ⊘ skipped ${GH_NAME} (${ENV_NAME} empty or absent in .env)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # `gh secret set` reads the value from stdin when --body is omitted.
  # Do NOT use `--body -` — that sets the secret literally to "-".
  printf '%s' "$VALUE" | gh secret set "$GH_NAME" --repo "$REPO"
  echo "  ✓ set ${GH_NAME} (from ${ENV_NAME})"
  PUSHED=$((PUSHED + 1))
done

echo ""
echo "Done — ${PUSHED} secret(s) pushed, ${SKIPPED} skipped."
echo ""
echo "Verify in GitHub:"
echo "  https://github.com/${REPO}/settings/secrets/actions"
