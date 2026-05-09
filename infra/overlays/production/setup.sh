#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# FS Suite — Production environment setup
#
# Creates the namespace, secrets, and applies all K8s manifests.
# Run once for initial setup, or re-run to update secrets.
#
# Prerequisites:
#   - Production kubeconfig configured (run setup-prod-kubeconfig.sh first)
#   - Neon PostgreSQL database created
#   - Upstash Redis database created
#   - Google OAuth credentials
#   - JWT RS256 keypair generated
#   - AES-256-GCM encryption key (32 bytes hex)
#
# Usage:
#   ./infra/overlays/production/setup.sh
# ──────────────────────────────────────────────────────────────

NAMESPACE="fs-suite"
CONTEXT="fs-suite-prod"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
K="kubectl --context ${CONTEXT}"

echo "╔══════════════════════════════════════════════╗"
echo "║     FS Suite — Production Setup              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Verify context ──────────────────────────────────────────

if ! kubectl config get-contexts "$CONTEXT" &>/dev/null; then
  echo "Error: context '${CONTEXT}' not found."
  echo "Run first: ./infra/scripts/setup-prod-kubeconfig.sh <user@vm-ip>"
  exit 1
fi

echo -e "Target context: \033[31m${CONTEXT}\033[0m (PRODUCTION)"
echo -n "Continue? [y/N] "
read -r confirm
if [[ "${confirm,,}" != "y" ]]; then
  echo "Cancelled."
  exit 0
fi
echo ""

# ── Prompt for secrets ──────────────────────────────────────

read_secret() {
  local prompt="$1"
  local var_name="$2"
  local default="${3:-}"

  if [[ -n "$default" ]]; then
    prompt="$prompt [$default]"
  fi

  echo -n "$prompt: "
  read -r value
  if [[ -z "$value" && -n "$default" ]]; then
    value="$default"
  fi
  eval "$var_name='$value'"
}

read_multiline() {
  local prompt="$1"
  local var_name="$2"
  echo "$prompt (paste content, then press Enter on empty line):"
  local content=""
  while IFS= read -r line; do
    [[ -z "$line" ]] && break
    content="${content}${line}\n"
  done
  eval "$var_name='$content'"
}

echo "── External databases ──"
echo ""
read_secret "Neon DATABASE_URL" DATABASE_URL
read_secret "Upstash REDIS_URL" REDIS_URL
echo ""

echo "── Google OAuth ──"
echo ""
read_secret "GOOGLE_CLIENT_ID" GOOGLE_CLIENT_ID
read_secret "GOOGLE_CLIENT_SECRET" GOOGLE_CLIENT_SECRET
echo ""

echo "── VATSIM OAuth (leave empty to skip) ──"
echo ""
read_secret "VATSIM_CLIENT_ID" VATSIM_CLIENT_ID ""
read_secret "VATSIM_CLIENT_SECRET" VATSIM_CLIENT_SECRET ""
echo ""

echo "── JWT RS256 keypair ──"
echo ""
read_multiline "JWT_PRIVATE_KEY" JWT_PRIVATE_KEY
read_multiline "JWT_PUBLIC_KEY" JWT_PUBLIC_KEY
echo ""

echo "── Encryption ──"
echo ""
read_secret "ENCRYPTION_KEY (32-byte hex)" ENCRYPTION_KEY
echo ""

echo "── Sentry (leave empty to skip) ──"
echo ""
read_secret "SENTRY_DSN" SENTRY_DSN ""
read_secret "SENTRY_AUTH_TOKEN" SENTRY_AUTH_TOKEN ""
echo ""

echo "── GHCR (image pull) ──"
echo ""
read_secret "GitHub PAT with read:packages scope" GHCR_PAT
echo ""

# ── Create namespace ────────────────────────────────────────

echo "Creating namespace ${NAMESPACE}..."
$K create namespace "$NAMESPACE" --dry-run=client -o yaml | $K apply -f -

# ── Create secret ───────────────────────────────────────────

echo "Creating api-secrets..."
$K create secret generic api-secrets \
  --namespace="$NAMESPACE" \
  --from-literal="DATABASE_URL=${DATABASE_URL}" \
  --from-literal="REDIS_URL=${REDIS_URL}" \
  --from-literal="GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}" \
  --from-literal="GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}" \
  --from-literal="VATSIM_CLIENT_ID=${VATSIM_CLIENT_ID}" \
  --from-literal="VATSIM_CLIENT_SECRET=${VATSIM_CLIENT_SECRET}" \
  --from-literal="JWT_PRIVATE_KEY=$(echo -e "${JWT_PRIVATE_KEY}")" \
  --from-literal="JWT_PUBLIC_KEY=$(echo -e "${JWT_PUBLIC_KEY}")" \
  --from-literal="ENCRYPTION_KEY=${ENCRYPTION_KEY}" \
  --from-literal="SENTRY_DSN=${SENTRY_DSN}" \
  --from-literal="SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}" \
  --dry-run=client -o yaml | $K apply -f -

# ── Create GHCR pull secret ────────────────────────────────

echo "Creating ghcr-pull-secret..."
$K create secret docker-registry ghcr-pull-secret \
  --namespace="$NAMESPACE" \
  --docker-server=ghcr.io \
  --docker-username=alexandre3gomes \
  --docker-password="${GHCR_PAT}" \
  --docker-email=noreply@fssuite.app \
  --dry-run=client -o yaml | $K apply -f -

# ── Apply manifests ─────────────────────────────────────────

echo "Applying K8s manifests..."
$K apply -k "$SCRIPT_DIR"

# ── Wait for rollout ────────────────────────────────────────

echo "Waiting for API deployment..."
$K rollout status deployment/api -n "$NAMESPACE" --timeout=300s

echo ""
echo "Verifying pods..."
$K get pods -n "$NAMESPACE"

echo ""
echo "✓ Production environment ready."
echo ""
echo "Verify health:"
echo "  kprod logs -l app.kubernetes.io/name=api --tail=20"
echo "  curl -s https://api.fssuite.app/v1/health"
