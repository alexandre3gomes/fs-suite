#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# FS Suite — Google Cloud Run setup (file-driven, WIF-only)
#
# Provisions every GCP resource the API needs:
#   - Artifact Registry repo (Docker images)
#   - Secret Manager secrets populated from a local .env
#   - Cloud Run runtime service account + IAM bindings
#
# Authentication for the GitHub Actions deploy job is handled
# separately by infra/cloudrun/setup-wif.sh (Workload Identity
# Federation, keyless). This script does NOT generate any
# long-lived service-account JSON key.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - GCP project created and billing enabled
#   - A canonical .env containing every value listed in
#     .env.example.production at the repo root
#
# Usage:
#   ./infra/cloudrun/setup.sh /path/to/.env [--project ID] [--region REGION]
#
# Idempotent: every resource is created-if-absent, every secret
# gets a new version appended.
# ──────────────────────────────────────────────────────────────

ENV_FILE=""
PROJECT_ID=""
REGION="europe-west2"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_ID="$2"; shift 2 ;;
    --region)  REGION="$2"; shift 2 ;;
    -h|--help)
      sed -n '4,30p' "$0"
      exit 0 ;;
    *) ENV_FILE="$1"; shift ;;
  esac
done

if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "Error: pass the path to your canonical .env as the first argument."
  echo "Usage: $0 /path/to/.env [--project ID] [--region REGION]"
  exit 1
fi

if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null || true)
fi
if [[ -z "$PROJECT_ID" ]]; then
  echo "Error: no GCP project. Set with --project or 'gcloud config set project ID'"
  exit 1
fi

echo "╔══════════════════════════════════════════════╗"
echo "║     FS Suite — Cloud Run Setup               ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Project: $PROJECT_ID"
echo "Region:  $REGION"
echo ".env:    $ENV_FILE"
echo ""

gcloud config set project "$PROJECT_ID" --quiet

# ── Enable APIs ────────────────────────────────────────────

echo "Enabling GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  iamcredentials.googleapis.com \
  --quiet

echo "APIs enabled."
echo ""

# ── Artifact Registry ─────────────────────────────────────

AR_REPO="fs-suite"

echo "Creating Artifact Registry repo '${AR_REPO}'..."
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="FS Suite Docker images" \
  2>/dev/null || echo "(repo already exists)"
echo ""

# ── Runtime service account ───────────────────────────────

RUNTIME_SA="fs-suite-runtime"
RUNTIME_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "$RUNTIME_SA" \
  --display-name="FS Suite Cloud Run Runtime" \
  2>/dev/null || echo "(Runtime SA already exists)"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet > /dev/null

echo "Runtime SA: $RUNTIME_EMAIL"
echo ""

# ── .env reader ───────────────────────────────────────────

read_var() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null \
    | head -1 \
    | cut -d= -f2- \
    | sed -e 's/^"//' -e 's/"$//'
}

# ── Secret Manager helper ─────────────────────────────────

# Creates the secret if absent, appends a new version, and grants
# secretAccessor to the runtime SA. Skips silently if value is empty
# so optional features (e.g. AVWX_TOKEN) don't pollute Secret Manager.
create_secret() {
  local gcp_name="$1"
  local env_var="$2"
  local value
  value=$(read_var "$env_var")

  if [[ -z "$value" ]]; then
    echo "  ⊘ skipped ${gcp_name} (${env_var} empty or absent in .env)"
    return 0
  fi

  gcloud secrets create "$gcp_name" --replication-policy="automatic" \
    2>/dev/null || true
  printf '%s' "$value" | gcloud secrets versions add "$gcp_name" \
    --data-file=- --quiet > /dev/null
  gcloud secrets add-iam-policy-binding "$gcp_name" \
    --member="serviceAccount:${RUNTIME_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet > /dev/null
  echo "  ✓ ${gcp_name} (from ${env_var})"
}

# ── Populate Secret Manager ───────────────────────────────

echo "── Populating Secret Manager ──"

# Required (deploy.yml --set-secrets references these by name).
create_secret "database-url"          "DATABASE_URL"
create_secret "redis-url"             "REDIS_URL"
create_secret "google-client-id"      "GOOGLE_CLIENT_ID"
create_secret "google-client-secret"  "GOOGLE_CLIENT_SECRET"
create_secret "jwt-private-key"       "JWT_PRIVATE_KEY"
create_secret "jwt-public-key"        "JWT_PUBLIC_KEY"
create_secret "encryption-key"        "ENCRYPTION_KEY"
create_secret "sentry-dsn"            "SENTRY_DSN"
create_secret "gemini-api-key"        "GEMINI_API_KEY"
create_secret "groq-api-key"          "GROQ_API_KEY"
create_secret "r2-account-id"         "R2_ACCOUNT_ID"
create_secret "r2-access-key-id"      "R2_ACCESS_KEY_ID"
create_secret "r2-secret-access-key"  "R2_SECRET_ACCESS_KEY"
create_secret "admin-metrics-token"   "ADMIN_METRICS_TOKEN"

# Optional. If you start using these features, add the matching line
# to .github/workflows/deploy.yml --set-secrets so Cloud Run injects
# them at runtime.
create_secret "owm-api-key"           "OWM_API_KEY"
create_secret "avwx-token"            "AVWX_TOKEN"

echo ""

# ── Summary ───────────────────────────────────────────────

echo "╔══════════════════════════════════════════════╗"
echo "║     Setup complete!                          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "  1. CI/CD auth — run the Workload Identity Federation setup"
echo "     (creates the keyless pipeline; no SA JSON key required):"
echo ""
echo "       ./infra/cloudrun/setup-wif.sh"
echo ""
echo "     Then add the secrets it prints to GitHub:"
echo "       GCP_PROJECT_ID, GCP_WIF_PROVIDER, GCP_WIF_SERVICE_ACCOUNT"
echo ""
echo "  2. DNS — map the production custom domain:"
echo ""
echo "       gcloud run domain-mappings create \\"
echo "         --service fs-suite-api \\"
echo "         --domain api.fs-suite.com \\"
echo "         --region ${REGION}"
echo ""
echo "     Only do this if you're cutting traffic over to Cloud Run."
echo "     Day-to-day, EC2 is primary; Cloud Run serves api-candidate."
echo ""
