# Greenfield — Google Cloud (Cloud Run)

Provisions the Cloud Run failover runtime: the project itself, Artifact
Registry for Docker images, Secret Manager for runtime secrets, the
runtime service account, and **keyless** auth from GitHub Actions via
Workload Identity Federation (WIF) — no long-lived service-account JSON
keys anywhere.

> **Reusing existing**: if a GCP project with Cloud Run already deployed
> exists and the WIF provider + service account are configured, skip to
> [Capture credentials](#capture-credentials).

## 1. Create the GCP project

```bash
gcloud auth login
gcloud projects create fs-suite --name="FS Suite"
gcloud config set project fs-suite
```

Link a billing account (Cloud Run free tier is generous, but the project
still must be linked):

```bash
gcloud billing accounts list  # find an account ID
gcloud billing projects link fs-suite --billing-account=<ID>
```

## 2. Provision the runtime (file-driven)

The `infra/cloudrun/setup.sh` script does everything from here on — APIs,
Artifact Registry, runtime SA, Secret Manager. Run with the canonical
`.env`:

```bash
./infra/cloudrun/setup.sh /path/to/.env
```

What it does (idempotent — safe to re-run):
- Enables the required GCP APIs (Cloud Run, Artifact Registry, Secret
  Manager, Cloud Build, IAM Credentials).
- Creates the Artifact Registry repo `fs-suite` in `europe-west2`.
- Creates the runtime service account `fs-suite-runtime` and grants it
  `roles/secretmanager.secretAccessor`.
- Reads each value from the `.env` and writes it as a Secret Manager
  secret with the canonical name (e.g. `DATABASE_URL` → `database-url`).
  Optional keys (`OWM_API_KEY`, `AVWX_TOKEN`) are skipped silently if
  empty in the `.env`.

Override the project or region with flags if needed:

```bash
./infra/cloudrun/setup.sh /path/to/.env --project fs-suite --region europe-west2
```

## 3. Workload Identity Federation (GitHub Actions auth)

Run the dedicated WIF setup script. It creates an OIDC identity pool, a
service account for the pipeline, and grants the SA the roles required
to deploy to Cloud Run + push to Artifact Registry.

```bash
./infra/cloudrun/setup-wif.sh
```

Save the three values it prints to **GitHub Secrets**:

```
GCP_PROJECT_ID=fs-suite
GCP_WIF_PROVIDER=projects/<num>/locations/global/workloadIdentityPools/github/providers/github
GCP_WIF_SERVICE_ACCOUNT=fs-suite-cicd@fs-suite.iam.gserviceaccount.com
```

These are category C secrets (pipeline auth), not in `.env`.

## 4. First deploy

After WIF is set up, the next push to `main` that touches `apps/api/**`
triggers `.github/workflows/deploy.yml`, which:

- Builds the Docker image and pushes to GHCR + Artifact Registry.
- Runs migrations via SSH to EC2 (Cloud Run reuses the same DB).
- Deploys to EC2 (primary).
- Deploys to Cloud Run (candidate).

To deploy manually without a push:

```bash
gh workflow run deploy.yml
```

## 5. Custom domain (optional)

Day-to-day, the Cloud Run service is reached via:

- The native URL (`https://fs-suite-api-<hash>-<region>.a.run.app`)
- The api-candidate Worker (`https://api-candidate.fs-suite.com` — set up
  in [cloudflare.md](cloudflare.md))

If you ever want Cloud Run to serve `api.fs-suite.com` directly (full
failover swap), map the custom domain:

```bash
gcloud run domain-mappings create \
  --service fs-suite-api \
  --domain api.fs-suite.com \
  --region europe-west2
```

This creates a CNAME target Cloud Run gives you. You'd point Cloudflare
DNS at it via a CNAME with the proxy **disabled** (the certificate flow
needs to see Google's hostname). See `infra/README.md` → Failover.

## Capture credentials

GCP doesn't produce any `.env` values — runtime secrets all come from the
`.env` and flow through Secret Manager. The only outputs are the three
GitHub Secrets from step 3.

## Validation

```bash
# Service exists and is healthy
gcloud run services describe fs-suite-api --region europe-west2 \
  --format='value(status.url,status.conditions[?type=Ready].status)'

# Curl the native URL through the API
URL=$(gcloud run services describe fs-suite-api --region europe-west2 \
        --format='value(status.url)')
curl -s "${URL}/v1/health"
# Expected: {"status":"ok","db":true,"redis":true,...}

# Secrets all present
gcloud secrets list --format='value(name)' | sort
```

The secret list should include at least: `database-url`, `redis-url`,
`google-client-id`, `google-client-secret`, `jwt-private-key`,
`jwt-public-key`, `encryption-key`, `sentry-dsn`, `gemini-api-key`,
`groq-api-key`, `r2-account-id`, `r2-access-key-id`,
`r2-secret-access-key`, `admin-metrics-token`. Plus `owm-api-key` and
`avwx-token` if you populated those in `.env`.
