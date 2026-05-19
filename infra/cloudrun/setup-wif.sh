#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# FS Suite — Workload Identity Federation Setup
#
# Replaces the long-lived GCP_SA_KEY JSON with keyless auth
# from GitHub Actions via Workload Identity Federation.
#
# Prerequisites:
#   - gcloud CLI authenticated with owner/editor role
#   - GCP project with Cloud Run already set up (run setup.sh first)
#   - GitHub repository: alexandre3gomes/fs-suite
#
# After running this script:
#   1. Add GitHub Secret: GCP_WIF_PROVIDER (printed at the end)
#   2. Add GitHub Secret: GCP_WIF_SERVICE_ACCOUNT (printed at the end)
#   3. Remove GitHub Secret: GCP_SA_KEY
#   4. Delete the old CI/CD service account key
# ──────────────────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════╗"
echo "║     FS Suite — Workload Identity Federation  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

read -rp "GCP Project ID: " PROJECT_ID
GITHUB_REPO="alexandre3gomes/fs-suite"
POOL_NAME="github-actions"
PROVIDER_NAME="github"
CICD_SA="fs-suite-cicd"

gcloud config set project "$PROJECT_ID"

# Enable IAM Credentials API
gcloud services enable iamcredentials.googleapis.com

# Create Workload Identity Pool
echo "Creating Workload Identity Pool..."
gcloud iam workload-identity-pools create "$POOL_NAME" \
  --location="global" \
  --display-name="GitHub Actions" \
  2>/dev/null || echo "(pool already exists)"

# Create OIDC Provider for GitHub
echo "Creating OIDC Provider..."
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
  --location="global" \
  --workload-identity-pool="$POOL_NAME" \
  --display-name="GitHub" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '${GITHUB_REPO}'" \
  2>/dev/null || echo "(provider already exists)"

# Get the full provider name
PROVIDER_FULL=$(gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
  --location="global" \
  --workload-identity-pool="$POOL_NAME" \
  --format="value(name)")

# Allow GitHub Actions to impersonate the CI/CD service account
CICD_EMAIL="${CICD_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts add-iam-policy-binding "$CICD_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${PROVIDER_FULL%.providers/*}/attribute.repository/${GITHUB_REPO}" \
  --quiet > /dev/null

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║     WIF Setup Complete                       ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Add these GitHub Secrets:"
echo ""
echo "  GCP_WIF_PROVIDER = ${PROVIDER_FULL}"
echo "  GCP_WIF_SERVICE_ACCOUNT = ${CICD_EMAIL}"
echo ""
echo "Then remove the old GCP_SA_KEY secret."
echo ""
