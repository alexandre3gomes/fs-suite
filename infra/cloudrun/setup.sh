#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# FS Suite — Google Cloud Run setup
#
# Creates all GCP resources needed for Cloud Run deployment:
#   - Artifact Registry repo (Docker images)
#   - Secret Manager secrets (runtime credentials)
#   - Service accounts (CI/CD + Cloud Run runtime)
#   - IAM bindings
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - GCP project created and billing enabled
#   - All secret values ready (DB URL, Redis, OAuth, JWT keys, etc.)
#
# Usage:
#   ./infra/cloudrun/setup.sh
# ──────────────────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════╗"
echo "║     FS Suite — Cloud Run Setup               ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Project configuration ──────────────────────────────────

read -rp "GCP Project ID: " PROJECT_ID
read -rp "GCP Region [southamerica-east1]: " REGION
REGION="${REGION:-southamerica-east1}"

gcloud config set project "$PROJECT_ID"

echo ""
echo "Project: $PROJECT_ID"
echo "Region:  $REGION"
echo -n "Continue? [y/N] "
read -r confirm
[[ "$confirm" != "y" && "$confirm" != "Y" ]] && echo "Cancelled." && exit 0
echo ""

# ── Enable APIs ────────────────────────────────────────────

echo "Enabling GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com

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

# ── Service accounts ──────────────────────────────────────

CICD_SA="fs-suite-cicd"
RUNTIME_SA="fs-suite-runtime"

echo "Creating service accounts..."

gcloud iam service-accounts create "$CICD_SA" \
  --display-name="FS Suite CI/CD" \
  2>/dev/null || echo "(CI/CD SA already exists)"

gcloud iam service-accounts create "$RUNTIME_SA" \
  --display-name="FS Suite Cloud Run Runtime" \
  2>/dev/null || echo "(Runtime SA already exists)"

CICD_EMAIL="${CICD_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "CI/CD SA:    $CICD_EMAIL"
echo "Runtime SA:  $RUNTIME_EMAIL"
echo ""

# CI/CD permissions: deploy to Cloud Run + push to Artifact Registry
for role in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${CICD_EMAIL}" \
    --role="$role" \
    --quiet > /dev/null
done

# Runtime permissions: access secrets
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet > /dev/null

echo "IAM bindings configured."
echo ""

# ── Secret Manager secrets ────────────────────────────────

read_secret() {
  local prompt="$1"
  local default="${2:-}"
  if [[ -n "$default" ]]; then
    prompt="$prompt [$default]"
  fi
  echo -n "$prompt: "
  read -r value
  [[ -z "$value" && -n "$default" ]] && value="$default"
  echo "$value"
}

read_multiline() {
  local prompt="$1"
  echo "$prompt (paste content, then Ctrl+D):"
  local content
  content=$(cat)
  echo "$content"
}

create_secret() {
  local name="$1"
  local value="$2"

  gcloud secrets create "$name" --replication-policy="automatic" 2>/dev/null || true
  echo -n "$value" | gcloud secrets versions add "$name" --data-file=-
  gcloud secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:${RUNTIME_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet > /dev/null
}

echo "── Secrets ──"
echo "Enter values for each secret. These are stored in GCP Secret Manager."
echo ""

echo "── External databases ──"
DB_URL=$(read_secret "DATABASE_URL (Neon connection string)")
REDIS=$(read_secret "REDIS_URL (Upstash connection string)")
echo ""

echo "── Google OAuth ──"
G_CLIENT_ID=$(read_secret "GOOGLE_CLIENT_ID")
G_CLIENT_SECRET=$(read_secret "GOOGLE_CLIENT_SECRET")
echo ""

echo "── JWT RS256 keypair ──"
JWT_PRIV=$(read_multiline "JWT_PRIVATE_KEY")
JWT_PUB=$(read_multiline "JWT_PUBLIC_KEY")
echo ""

echo "── Encryption ──"
ENC_KEY=$(read_secret "ENCRYPTION_KEY (32-byte hex)")
echo ""

echo "── Sentry (press Enter to skip) ──"
SENTRY=$(read_secret "SENTRY_DSN" "")
echo ""

echo "── AI providers (press Enter to skip) ──"
GEMINI=$(read_secret "GEMINI_API_KEY" "")
GROQ=$(read_secret "GROQ_API_KEY" "")
echo ""

echo "── Cloudflare R2 (press Enter to skip) ──"
R2_ACCT=$(read_secret "R2_ACCOUNT_ID" "")
R2_KEY=$(read_secret "R2_ACCESS_KEY_ID" "")
R2_SECRET=$(read_secret "R2_SECRET_ACCESS_KEY" "")
echo ""

echo "Creating secrets in Secret Manager..."
create_secret "database-url" "$DB_URL"
create_secret "redis-url" "$REDIS"
create_secret "google-client-id" "$G_CLIENT_ID"
create_secret "google-client-secret" "$G_CLIENT_SECRET"
create_secret "jwt-private-key" "$JWT_PRIV"
create_secret "jwt-public-key" "$JWT_PUB"
create_secret "encryption-key" "$ENC_KEY"
create_secret "sentry-dsn" "$SENTRY"
create_secret "gemini-api-key" "$GEMINI"
create_secret "groq-api-key" "$GROQ"
create_secret "r2-account-id" "$R2_ACCT"
create_secret "r2-access-key-id" "$R2_KEY"
create_secret "r2-secret-access-key" "$R2_SECRET"

echo "All secrets created."
echo ""

# ── Generate CI/CD service account key ────────────────────

echo "Generating CI/CD service account key..."
KEY_FILE="/tmp/fs-suite-cicd-key.json"
gcloud iam service-accounts keys create "$KEY_FILE" \
  --iam-account="$CICD_EMAIL"
echo ""

# ── Summary ───────────────────────────────────────────────

echo "╔══════════════════════════════════════════════╗"
echo "║     Setup complete!                          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Add these GitHub Secrets to your repository:"
echo "  Settings > Secrets and variables > Actions"
echo ""
echo "  GCP_PROJECT_ID = $PROJECT_ID"
echo "  GCP_REGION     = $REGION"
echo "  GCP_SA_KEY     = $(cat "$KEY_FILE")"
echo ""
echo "The SA key is also saved at: $KEY_FILE"
echo "Delete it after copying to GitHub: rm $KEY_FILE"
echo ""
echo "DNS: Point api.fs-suite.com to the Cloud Run URL"
echo "  gcloud run services describe fs-suite-api --region $REGION --format 'value(status.url)'"
echo ""
echo "Custom domain mapping:"
echo "  gcloud run domain-mappings create --service fs-suite-api --domain api.fs-suite.com --region $REGION"
echo ""
