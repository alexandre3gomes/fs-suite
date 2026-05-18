# Infrastructure — FS Suite

Google Cloud Run deployment for the API, with Cloudflare Worker reverse proxy for custom domain routing.

## Structure

```
infra/
├── cloudrun/
│   └── setup.sh          # Interactive GCP setup (APIs, Artifact Registry, service accounts, secrets)
└── README.md
```

## Local Development

Local development does **not** use Cloud Run. Services run directly:

| Component | How | Port |
|-----------|-----|------|
| API (NestJS) | `pnpm dev` | `localhost:3001` |
| App (Expo) | `pnpm dev` | `localhost:8081` |
| PostgreSQL | Docker container | `localhost:5432` |
| Redis | Docker container | `localhost:6379` |

```bash
docker compose up -d
pnpm dev
```

## Production

### Topology

| Component | Service | Details |
|-----------|---------|---------|
| Frontend | Cloudflare Pages | Project `fs-suite-app` |
| API | Google Cloud Run | `europe-west2` (London), colocated with DB |
| Database | Neon | Serverless PostgreSQL, London region |
| Cache | Upstash | Serverless Redis, TLS |
| DNS/SSL | Cloudflare | Automatic TLS + Worker reverse proxy |
| Container Registry | Google Artifact Registry | `europe-west2-docker.pkg.dev` |
| Secrets | Google Secret Manager | Runtime secrets injected via `--set-secrets` |

### Domain and DNS

Domain `fs-suite.com` is managed via Cloudflare.

| Record | Type | Target | Proxy |
|--------|------|--------|-------|
| `fs-suite.com` | CNAME | `fs-suite-app.pages.dev` | Proxied |
| `api.fs-suite.com` | — | Cloudflare Worker (`winter-pine-bca5`) | — |

The API uses a **Cloudflare Worker** as reverse proxy because Cloud Run's auto-generated hostname doesn't match `api.fs-suite.com`. The Worker rewrites the `Host` header and forwards requests to the Cloud Run service URL.

### Network Diagram

```
Internet → Cloudflare (SSL/CDN)
                │
        ┌───────┴────────┐
        │                │
  fs-suite.com    api.fs-suite.com
        │                │
  Cloudflare Pages   Cloudflare Worker
  (static files)     (reverse proxy)
                         │
                  Google Cloud Run
                  europe-west2 (London)
                  ┌─────────┐
                  │   API   │
                  │  :3001  │
                  └────┬────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
  Neon (Postgres) Upstash (Redis) Google
  (London, TLS)  (external TLS)  (OAuth)
```

### Cloud Run Configuration

| Setting | Value |
|---------|-------|
| Region | `europe-west2` (London) |
| CPU | 1 |
| Memory | 512Mi |
| Min instances | 0 (free tier) |
| Max instances | 2 |
| Concurrency | 80 |
| Timeout | 300s |
| CPU boost | Enabled (reduces cold start) |
| Port | 3001 |
| Runtime SA | `fs-suite-runtime@fs-suite.iam.gserviceaccount.com` |

### Initial Setup

```bash
# 1. Install gcloud CLI and authenticate
gcloud auth login
gcloud config set project fs-suite

# 2. Run interactive setup (creates APIs, registry, service accounts, secrets)
./infra/cloudrun/setup.sh

# 3. Configure GitHub Secrets (see CI/CD section)
```

## CI/CD

Branching model: **feature branches → PR → merge to main**.

| Workflow | Trigger | Action |
|----------|---------|--------|
| `ci.yml` | Push to `main` + PRs | Install, lint, typecheck, build, test |
| `deploy.yml` | Push to `main` (API/packages paths) | Build Docker → Artifact Registry → Cloud Run deploy |
| `deploy-app.yml` | Push to `main` (app/UI paths) | Expo web export → Cloudflare Pages |

### GitHub Secrets

| Secret | Used by |
|--------|---------|
| `GCP_PROJECT_ID` | `deploy.yml` — GCP project ID (`fs-suite`) |
| `GCP_REGION` | `deploy.yml` — Cloud Run region (`europe-west2`) |
| `GCP_SA_KEY` | `deploy.yml` — CI/CD service account JSON key |
| `CLOUDFLARE_API_TOKEN` | `deploy-app.yml` — Cloudflare Pages deploy |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy-app.yml` — Cloudflare account ID |

### GCP Service Accounts

| Account | Role |
|---------|------|
| `fs-suite-cicd` | CI/CD — pushes images, deploys Cloud Run, manages secrets |
| `fs-suite-runtime` | Runtime — Cloud Run service account with `secretAccessor` role |

### Deploy API (Cloud Run)

On each merge to `main` that changes API code:

1. Builds amd64 Docker image and pushes to Artifact Registry (tagged with git SHA + `latest`)
2. Deploys to Cloud Run with `gcloud run deploy`, injecting env vars and secrets
3. Verifies deployment via health check (`/v1/health`)

### Deploy App (Cloudflare Pages)

On each merge to `main` that changes frontend code:

1. Installs dependencies and builds Expo web (`expo export --platform web`)
2. Deploys static files to Cloudflare Pages via `wrangler`
3. Global CDN distributes automatically

## Secrets (Google Secret Manager)

All production secrets are stored in Google Secret Manager and injected at runtime via Cloud Run's `--set-secrets` flag.

| Secret | Description |
|--------|-------------|
| `database-url` | PostgreSQL connection string (Neon) |
| `redis-url` | Redis connection string (Upstash, `rediss://` for TLS) |
| `google-client-id` / `google-client-secret` | Google OAuth credentials |
| `jwt-private-key` / `jwt-public-key` | RS256 keypair |
| `encryption-key` | AES-256-GCM key (32-byte hex) |
| `sentry-dsn` | Sentry error tracking |
| `gemini-api-key` / `groq-api-key` | AI model API keys |
| `r2-account-id` / `r2-access-key-id` / `r2-secret-access-key` | Cloudflare R2 storage |

**Never commit real secrets.**

## Database Migrations

Prisma migrations are **not** run automatically on container startup. Run them ad-hoc:

```bash
# From a machine with DATABASE_URL set
cd apps/api
npx prisma migrate deploy
```
