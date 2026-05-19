# Infrastructure — FS Suite

EC2 (primary) + Cloud Run (standby). Single build, parallel deploy.

## Structure

```
infra/
├── ec2/
│   ├── docker-compose.yml   # Production services: nginx (TLS) + api
│   └── setup.sh             # Interactive one-time EC2 provisioning
├── cloudrun/
│   ├── setup.sh             # GCP setup (Artifact Registry, Secret Manager, IAM)
│   └── setup-wif.sh         # Workload Identity Federation (replaces SA key)
└── README.md
```

## Local Development

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

## Production Topology

```
Internet → Cloudflare (TLS termination + proxy)
                │
     ┌──────────┼──────────────────┐
     │          │                  │
fs-suite.com  api.fs-suite.com  api-standby.fs-suite.com
     │          │                  │
  CF Pages   EC2 t3.small     Cloud Run
  (static)   (primary)        (standby)
             eu-west-1        europe-west2
             ┌──────────┐
             │  nginx   │ :443 (Origin Cert)
             │    ↓     │
             │   API    │ :3001
             └────┬─────┘
                  │
     ┌────────────┼────────────┐
     │            │            │
Neon (Postgres) Upstash    Google
(London, TLS)  (Redis)    (OAuth)
```

### Components

| Component | Service | Role | Details |
|-----------|---------|------|---------|
| Frontend | Cloudflare Pages | Static hosting | `fs-suite.com` |
| API | EC2 t3.small | **Primary** | Amazon Linux 2023, `eu-west-1` |
| API | Cloud Run | **Standby** | `europe-west2`, `min-instances: 0` |
| Database | Neon | Shared | Serverless PostgreSQL, London |
| Cache | Upstash | Shared | Serverless Redis, TLS |
| DNS/TLS | Cloudflare | Edge | Proxied, Full (Strict) mode |

### Container Registries

| Registry | Used by | Image |
|----------|---------|-------|
| GHCR | EC2 | `ghcr.io/alexandre3gomes/fs-suite-api` |
| Artifact Registry | Cloud Run | `europe-west2-docker.pkg.dev/fs-suite/fs-suite/api` |

### Secrets Management

| Runtime | Where | How |
|---------|-------|-----|
| EC2 | `/opt/fs-suite/.env` | File on disk, `chmod 600` |
| Cloud Run | GCP Secret Manager | Injected via `--set-secrets` at deploy |

### DNS Records

| Record | Type | Target | Proxy |
|--------|------|--------|-------|
| `fs-suite.com` | CNAME | `fs-suite-app.pages.dev` | Proxied |
| `api.fs-suite.com` | A | EC2 Elastic IP (`52.18.13.237`) | Proxied |
| `api-standby.fs-suite.com` | — | Cloudflare Worker → Cloud Run | — |

## EC2 Setup

```bash
# 1. Launch EC2 t3.small (Amazon Linux 2023) in eu-west-1
# 2. Allocate Elastic IP and associate
# 3. Security Group: ports 443+80 open, port 22 open (key-only auth)

# 4. SSH in and run setup
ssh fs-suite
curl -sO https://raw.githubusercontent.com/alexandre3gomes/fs-suite/main/infra/ec2/setup.sh
chmod +x setup.sh && ./setup.sh
```

The setup script:
1. Installs Docker + Docker Compose
2. Collects Cloudflare Origin Certificate (TLS on origin)
3. Configures nginx (HTTPS :443, redirect :80 → :443)
4. Collects all secrets interactively (sensitive values hidden)
5. Writes `.env` (chmod 600) with JWT keys in escaped-newline format
6. Pulls image from GHCR and starts services
7. Verifies health check

### TLS Configuration

EC2 uses a **Cloudflare Origin Certificate** for TLS on the origin:
- Nginx terminates TLS on port 443
- Port 80 redirects to HTTPS
- Cloudflare SSL/TLS mode: **Full (Strict)**
- Certificate stored at `/opt/fs-suite/certs/` (chmod 600 for private key)

Generate the certificate at: Cloudflare > SSL/TLS > Origin Server > Create Certificate

### JWT Keys

RS256 PEM keys are stored in `.env` with escaped newlines (`\n` as literal `\\n`).
The API converts them back at runtime (`auth.module.ts`).

The setup script handles the conversion automatically: paste the real PEM,
it writes the escaped version.

## Cloud Run Setup

```bash
gcloud auth login
gcloud config set project fs-suite
./infra/cloudrun/setup.sh
```

### Workload Identity Federation (recommended)

To replace the long-lived `GCP_SA_KEY` with keyless auth:

```bash
./infra/cloudrun/setup-wif.sh
```

Then add GitHub Secrets `GCP_WIF_PROVIDER` and `GCP_WIF_SERVICE_ACCOUNT`,
and remove `GCP_SA_KEY`. The deploy workflow supports both methods.

## SSH Access

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
docker compose run --rm api npx prisma migrate deploy   # Run migrations
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
     ▼
┌──────────┐
│ Migrate  │  prisma migrate deploy (via EC2 SSH)
│          │  Shared Neon database — runs once
└────┬─────┘
     │
     ├──────────────────┐
     ▼                  ▼
┌──────────┐    ┌─────────────┐
│ Deploy   │    │ Deploy      │
│ EC2      │    │ Cloud Run   │
│ (SSH)    │    │ (gcloud)    │
└──────────┘    └─────────────┘
```

**Rollout order**: build → migrate → deploy (EC2 + Cloud Run in parallel).
Migrations run against the shared Neon database before any runtime is updated.

### Workflows

| Workflow | Trigger | Action |
|----------|---------|--------|
| `ci.yml` | Push to `main` + PRs | Install, lint, typecheck, build, test |
| `deploy.yml` | Push to `main` (API/packages paths) | Build → migrate → deploy EC2 + Cloud Run |
| `deploy-app.yml` | Push to `main` (app/UI paths) | Expo web export → Cloudflare Pages |

### GitHub Secrets

| Secret | Used by | Notes |
|--------|---------|-------|
| `EC2_HOST` | `deploy.yml` | Elastic IP |
| `EC2_SSH_KEY` | `deploy.yml` | SSH private key for ec2-user |
| `EC2_USER` | `deploy.yml` | `ec2-user` |
| `GCP_PROJECT_ID` | `deploy.yml` | `fs-suite` |
| `GCP_SA_KEY` | `deploy.yml` | GCP CI/CD SA JSON key (legacy, migrate to WIF) |
| `GCP_WIF_PROVIDER` | `deploy.yml` | WIF provider (replaces GCP_SA_KEY) |
| `GCP_WIF_SERVICE_ACCOUNT` | `deploy.yml` | WIF service account (replaces GCP_SA_KEY) |
| `CLOUDFLARE_API_TOKEN` | `deploy-app.yml` | Cloudflare Pages deploy |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy-app.yml` | Cloudflare account ID |

**Deprecated**: `GCP_REGION` — region is now hardcoded to `europe-west2`.

### GHCR Authentication

- **Setup (one-time)**: PAT with `read:packages` scope, used during `setup.sh`
- **Automated deploys**: `GITHUB_TOKEN` from Actions, passed via SSH to EC2

## Secrets Reference

| Secret | Description |
|--------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Neon) |
| `REDIS_URL` | Redis connection string (Upstash, `rediss://` for TLS) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | RS256 keypair (escaped newlines in .env) |
| `ENCRYPTION_KEY` | AES-256-GCM key (32-byte hex) |
| `SENTRY_DSN` | Sentry error tracking |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | AI model API keys |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare R2 storage |

**Never commit real secrets.**

## Failover: EC2 → Cloud Run

Cloud Run is always deployed in parallel and ready to serve traffic.

### Activate standby

1. In Cloudflare DNS, change `api.fs-suite.com`:
   - Delete the A record pointing to EC2 Elastic IP
   - Create a CNAME pointing to the Cloud Run URL (from `gcloud run services describe fs-suite-api --region europe-west2 --format 'value(status.url)'`)
   - Or switch the app to use `api-standby.fs-suite.com` directly
2. Verify: `curl https://api.fs-suite.com/v1/health`

### Return to primary

1. In Cloudflare DNS, change `api.fs-suite.com` back:
   - Delete the CNAME
   - Create A record → `52.18.13.237` (Proxied)
2. Verify: `curl https://api.fs-suite.com/v1/health`

### What stays intact during failover

- Database (Neon) — shared, no migration needed
- Redis (Upstash) — shared, sessions persist
- OAuth callbacks — `GOOGLE_CALLBACK_URL` points to `api.fs-suite.com` on both runtimes
- Secrets — independent copies (`.env` on EC2, Secret Manager on GCP)

## Database Migrations

Migrations run automatically as part of the deploy pipeline (after build, before API restart).

For manual migrations:

```bash
ssh fs-suite
cd /opt/fs-suite
docker compose run --rm api npx prisma migrate deploy
```

## Post-Deploy Checklist

| Check | Command | Expected |
|-------|---------|----------|
| API health | `curl https://api.fs-suite.com/v1/health` | `{"status":"ok"}` |
| Standby health | `curl https://api-standby.fs-suite.com/v1/health` | `{"status":"ok"}` |
| Auth flow | Sign in at `https://fs-suite.com` | Google OAuth completes |
| DB connectivity | Check API logs for Prisma errors | No connection errors |
| Redis connectivity | Check API logs for Redis errors | No connection errors |
| Container status | `ssh fs-suite 'docker compose -f /opt/fs-suite/docker-compose.yml ps'` | Both healthy |
