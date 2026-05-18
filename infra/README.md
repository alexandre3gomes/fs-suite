# Infrastructure — FS Suite

EC2 deployment for the API, with Cloudflare proxied DNS for TLS termination.

## Structure

```
infra/
├── ec2/
│   ├── docker-compose.yml   # Production services: nginx + api
│   └── setup.sh             # Interactive one-time EC2 provisioning
├── cloudrun/
│   └── setup.sh             # Cloud Run setup (rollback option)
└── README.md
```

## Local Development

Local development does **not** use Docker Compose from infra. Services run directly:

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
| API | EC2 t3.small | Amazon Linux 2023, `eu-west-1` (Ireland) |
| Database | Neon | Serverless PostgreSQL, London region |
| Cache | Upstash | Serverless Redis, TLS |
| DNS/SSL | Cloudflare | Automatic TLS, proxied A record |
| Container Registry | GHCR | `ghcr.io/alexandre3gomes/fs-suite-api` |
| Secrets | `.env` on EC2 | `/opt/fs-suite/.env` (chmod 600) |

### Domain and DNS

Domain `fs-suite.com` is managed via Cloudflare.

| Record | Type | Target | Proxy |
|--------|------|--------|-------|
| `fs-suite.com` | CNAME | `fs-suite-app.pages.dev` | Proxied |
| `api.fs-suite.com` | A | EC2 Elastic IP | Proxied |

Cloudflare terminates TLS (SSL mode: Full). Nginx on the EC2 listens on port 80 only.

### Network Diagram

```
Internet → Cloudflare (SSL/CDN)
                │
        ┌───────┴────────┐
        │                │
  fs-suite.com    api.fs-suite.com
        │                │ (A record → Elastic IP)
  Cloudflare Pages   EC2 t3.small (eu-west-1)
  (static files)     Amazon Linux 2023
                     ┌──────────┐
                     │  nginx   │ :80
                     │    ↓     │
                     │   API    │ :3001
                     └────┬─────┘
                          │
           ┌──────────────┼──────────────┐
           │              │              │
     Neon (Postgres) Upstash (Redis) Google
     (London, TLS)  (external TLS)  (OAuth)
```

### Initial Setup

```bash
# 1. Launch EC2 t3.small (Amazon Linux 2023) in eu-west-1
# 2. Allocate Elastic IP and associate with instance
# 3. Security Group: port 80 (HTTP) open, port 22 (SSH) restricted

# 4. SSH in and run setup
ssh ec2-user@<elastic-ip>
curl -sO https://raw.githubusercontent.com/alexandre3gomes/fs-suite/main/infra/ec2/setup.sh
chmod +x setup.sh && ./setup.sh

# 5. Configure GitHub Secrets (see CI/CD section)
# 6. Cloudflare: A record api.fs-suite.com → Elastic IP (Proxied)
```

### SSH Access

```bash
ssh fs-suite           # uses ~/.ssh/config alias
```

### Useful Commands

```bash
docker compose logs -f api           # Stream API logs
docker compose restart api           # Restart API
docker compose pull && docker compose up -d  # Manual deploy
docker compose exec api npx prisma migrate deploy  # Run migrations
```

## CI/CD

Branching model: **feature branches → PR → merge to main**.

| Workflow | Trigger | Action |
|----------|---------|--------|
| `ci.yml` | Push to `main` + PRs | Install, lint, typecheck, build, test |
| `deploy.yml` | Push to `main` (API/packages paths) | Build Docker → GHCR → EC2 deploy via SSH |
| `deploy-app.yml` | Push to `main` (app/UI paths) | Expo web export → Cloudflare Pages |
| `deploy-cloudrun.yml` | Manual (workflow_dispatch) | Rollback: deploy to Cloud Run |

### GitHub Secrets

| Secret | Used by |
|--------|---------|
| `EC2_HOST` | `deploy.yml` — EC2 Elastic IP |
| `EC2_SSH_KEY` | `deploy.yml` — SSH private key for ec2-user |
| `EC2_USER` | `deploy.yml` — SSH user (`ec2-user`) |
| `CLOUDFLARE_API_TOKEN` | `deploy-app.yml` — Cloudflare Pages deploy |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy-app.yml` — Cloudflare account ID |

### Deploy API (EC2)

On each merge to `main` that changes API code:

1. Builds amd64 Docker image and pushes to GHCR (tagged with git SHA + `latest`)
2. SSHs into EC2, pulls new image, restarts container
3. Verifies health check and container status

### Deploy App (Cloudflare Pages)

On each merge to `main` that changes frontend code:

1. Installs dependencies and builds Expo web (`expo export --platform web`)
2. Deploys static files to Cloudflare Pages via `wrangler`
3. Global CDN distributes automatically

## Secrets

All production secrets are stored in `/opt/fs-suite/.env` on the EC2 (chmod 600).

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

Prisma migrations are **not** run automatically on deploy. Run them ad-hoc:

```bash
ssh fs-suite
cd /opt/fs-suite
docker compose exec api npx prisma migrate deploy
```

## Rollback to Cloud Run

If EC2 doesn't work out, Cloud Run resources are still in place:

1. Run `deploy-cloudrun.yml` manually via GitHub Actions (workflow_dispatch)
2. Re-point DNS: change A record to Cloudflare Worker or Cloud Run custom domain
3. GCP resources (Artifact Registry, Secret Manager, service accounts) were not deleted
