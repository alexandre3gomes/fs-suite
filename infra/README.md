# Infrastructure — FS Suite

Dual deployment: EC2 (primary) + Cloud Run (fallback), with parallel deploys from a single build.

## Structure

```
infra/
├── ec2/
│   ├── docker-compose.yml   # Production services: nginx + api
│   └── setup.sh             # Interactive one-time EC2 provisioning
├── cloudrun/
│   └── setup.sh             # GCP setup (Artifact Registry, Secret Manager, IAM)
└── README.md
```

## Local Development

Services run directly, no Docker Compose from infra:

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
| Frontend | Cloudflare Pages | `fs-suite.com` |
| API (primary) | EC2 t3.small | Amazon Linux 2023, `eu-west-1`, `api.fs-suite.com` |
| API (fallback) | Google Cloud Run | `europe-west2`, `api-candidate.fs-suite.com` (via Cloudflare Worker) |
| Database | Neon | Serverless PostgreSQL, London |
| Cache | Upstash | Serverless Redis, TLS |
| DNS/SSL | Cloudflare | Automatic TLS (Flexible mode for EC2) |
| Registry (EC2) | GHCR | `ghcr.io/alexandre3gomes/fs-suite-api` |
| Registry (Cloud Run) | Artifact Registry | `europe-west2-docker.pkg.dev/fs-suite/fs-suite/api` |
| Secrets (EC2) | `.env` on EC2 | `/opt/fs-suite/.env` (chmod 600) |
| Secrets (Cloud Run) | Secret Manager | GCP Secret Manager, injected via `--set-secrets` |

### Domain and DNS

| Record | Type | Target | Proxy |
|--------|------|--------|-------|
| `fs-suite.com` | CNAME | `fs-suite-app.pages.dev` | Proxied |
| `api.fs-suite.com` | A | EC2 Elastic IP (`52.18.13.237`) | Proxied |
| `api-candidate.fs-suite.com` | — | Cloudflare Worker → Cloud Run | — |

### Network Diagram

```
Internet → Cloudflare (TLS)
                │
     ┌──────────┼──────────────────┐
     │          │                  │
fs-suite.com  api.fs-suite.com  api-candidate.fs-suite.com
     │          │                  │
  CF Pages   EC2 t3.small     CF Worker → Cloud Run
             (eu-west-1)      (europe-west2)
             ┌──────────┐
             │  nginx   │ :80
             │    ↓     │
             │   API    │ :3001
             └────┬─────┘
                  │
     ┌────────────┼────────────┐
     │            │            │
Neon (Postgres) Upstash    Google
(London, TLS)  (Redis)    (OAuth)
```

### EC2 Setup

```bash
# 1. Launch EC2 t3.small (Amazon Linux 2023) in eu-west-1
# 2. Allocate Elastic IP and associate
# 3. Security Group: port 80 (HTTP) open, port 22 (SSH) restricted

# 4. SSH in and run setup
ssh fs-suite
curl -sO https://raw.githubusercontent.com/alexandre3gomes/fs-suite/main/infra/ec2/setup.sh
chmod +x setup.sh && ./setup.sh
```

### Cloud Run Setup

```bash
gcloud auth login
gcloud config set project fs-suite
./infra/cloudrun/setup.sh
```

### SSH Access

```bash
# ~/.ssh/config
Host fs-suite
    HostName 52.18.13.237
    User ec2-user
    IdentityFile ~/.ssh/id_ed25519

ssh fs-suite
```

### Useful Commands

```bash
docker compose logs -f api                              # Stream API logs
docker compose restart api                              # Restart API
docker compose pull && docker compose up -d             # Manual deploy
docker compose exec api npx prisma migrate deploy       # Run migrations
```

## CI/CD

Branching model: **feature branches → PR → merge to main**.

### Deploy Pipeline

```
push to main
    │
    ▼
┌─────────┐
│  Build  │  Build Docker image once
│         │  Push to GHCR + Artifact Registry
└────┬────┘
     │
     ├──────────────────┐
     ▼                  ▼
┌──────────┐    ┌─────────────┐
│ Deploy   │    │ Deploy      │
│ EC2      │    │ Cloud Run   │
│ (SSH)    │    │ (gcloud)    │
└──────────┘    └─────────────┘
```

| Workflow | Trigger | Action |
|----------|---------|--------|
| `ci.yml` | Push to `main` + PRs | Install, lint, typecheck, build, test |
| `deploy.yml` | Push to `main` (API/packages paths) | Build → push to GHCR + AR → deploy EC2 + Cloud Run in parallel |
| `deploy-app.yml` | Push to `main` (app/UI paths) | Expo web export → Cloudflare Pages |

### GitHub Secrets

| Secret | Used by |
|--------|---------|
| `EC2_HOST` | `deploy.yml` — EC2 Elastic IP |
| `EC2_SSH_KEY` | `deploy.yml` — SSH private key for ec2-user |
| `EC2_USER` | `deploy.yml` — SSH user (`ec2-user`) |
| `GCP_PROJECT_ID` | `deploy.yml` — GCP project (`fs-suite`) |
| `GCP_REGION` | `deploy.yml` — Cloud Run region (`europe-west2`) |
| `GCP_SA_KEY` | `deploy.yml` — GCP CI/CD service account JSON key |
| `CLOUDFLARE_API_TOKEN` | `deploy-app.yml` — Cloudflare Pages deploy |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy-app.yml` — Cloudflare account ID |

## Secrets

### EC2 — `/opt/fs-suite/.env`

All secrets stored as a file on disk (chmod 600).

### Cloud Run — Google Secret Manager

All secrets injected at runtime via `--set-secrets`.

| Secret | Description |
|--------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Neon) |
| `REDIS_URL` | Redis connection string (Upstash, `rediss://` for TLS) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | RS256 keypair |
| `ENCRYPTION_KEY` | AES-256-GCM key (32-byte hex) |
| `SENTRY_DSN` | Sentry error tracking |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | AI model API keys |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare R2 storage |

**Never commit real secrets.**

## Database Migrations

Not run automatically on deploy. Run ad-hoc:

```bash
ssh fs-suite
cd /opt/fs-suite
docker compose exec api npx prisma migrate deploy
```

## Failover to Cloud Run

If EC2 goes down:

1. In Cloudflare DNS, change `api.fs-suite.com` A record to point to Cloud Run (via Worker or custom domain)
2. Or switch app to use `api-candidate.fs-suite.com` directly
3. Cloud Run is always up-to-date (parallel deploy)
