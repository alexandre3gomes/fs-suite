# Infrastructure — FS Suite

EC2 (primary) + Cloud Run (candidate). Single build, parallel deploy.

## Structure

```
infra/
├── ec2/
│   ├── docker-compose.yml   # Production services: nginx (TLS) + api
│   ├── .env.example         # Template for required environment variables
│   └── setup.sh             # File-driven one-time EC2 provisioning
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
fs-suite.com  api.fs-suite.com  api-candidate.fs-suite.com
     │          │                  │
  CF Pages   EC2 t3.small     Cloud Run
  (static)   (primary)        (candidate)
             eu-west-1        europe-west2
             ┌──────────┐
             │  nginx   │ :443 (Origin Cert)
             │    ↓     │
             │   API    │ :3001
             └────┬─────┘
                  │
     ┌────────────┼────────────┐
     │            │            │
Supabase (PG) Upstash    Google
(eu-central-1) (Redis)    (OAuth)
```

### Components

| Component | Service | Role | Details |
|-----------|---------|------|---------|
| Frontend | Cloudflare Pages | Static hosting | `fs-suite.com` |
| API | EC2 t3.small | **Primary** | Amazon Linux 2023, `eu-west-1` |
| API | Cloud Run | **Candidate** | `europe-west2`, `min-instances: 0` |
| Database | Supabase | Shared | PostgreSQL, `eu-central-1`, accessed via Supavisor session-mode pooler (IPv4) |
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
| `api-candidate.fs-suite.com` | — | Cloudflare Worker → Cloud Run | — |

## EC2 Setup

```bash
# 1. Launch EC2 t3.small (Amazon Linux 2023) in eu-west-1
# 2. Allocate Elastic IP and associate
# 3. Security Group: ports 443+80 open, port 22 open (key-only auth)

# 4. Copy files and run setup
scp .env origin.pem origin-key.pem fs-suite:~/
ssh fs-suite
curl -sO https://raw.githubusercontent.com/alexandre3gomes/fs-suite/main/infra/ec2/setup.sh
chmod +x setup.sh && ./setup.sh
```

The setup script:
1. Installs Docker + Docker Compose
2. Copies Cloudflare Origin Certificate (TLS on origin)
3. Configures nginx (HTTPS :443, redirect :80 → :443)
4. Processes `.env` file and adds non-secret defaults
5. Generates a fresh JWT RS256 keypair (see [JWT Keys](#jwt-keys))
6. Writes final `.env` (chmod 600)
7. Pulls image from GHCR and starts services
8. Verifies health check

### TLS Configuration

EC2 uses a **Cloudflare Origin Certificate** for TLS on the origin:
- Nginx terminates TLS on port 443
- Port 80 redirects to HTTPS
- Cloudflare SSL/TLS mode: **Full (Strict)**
- Certificate stored at `/opt/fs-suite/certs/` (chmod 600 for private key)

Generate the certificate at: Cloudflare > SSL/TLS > Origin Server > Create Certificate

### JWT Keys

The setup script generates a fresh RS256 2048-bit keypair on every run using `openssl`.
The keys are written to `.env` in escaped single-line format and are not provided externally.

**Tradeoff**: regenerating the keypair invalidates all existing JWT access and refresh tokens.
Users will need to sign in again after a reprovisioning. No data is lost — Google OAuth issues
new tokens on the next login. This is a deliberate decision: it avoids the complexity of
managing the keypair as a separate persistent secret, and the impact (re-login) is acceptable
at the current product stage.

### SSH Access

```bash
# ~/.ssh/config
Host fs-suite
    HostName 52.18.13.237
    User ec2-user
    IdentityFile ~/.ssh/id_ed25519

ssh fs-suite
```

#### Security Posture

Port 22 is open to `0.0.0.0/0`. This is a deliberate decision — both the developer machine
and GitHub Actions (via `appleboy/ssh-action`) need SSH access, and Actions runner IPs are
not predictable.

**What this project assumes** (provided by the AMI/instance baseline, not by `setup.sh`):
- Authentication is key-only (Amazon Linux 2023 defaults: `PasswordAuthentication no`)
- Root login is disabled (`PermitRootLogin no` in AMI default)
- Only `ec2-user` is accessible

The setup script does not modify `sshd_config`. These protections depend on the Amazon Linux
2023 AMI defaults remaining in place. If using a different AMI or if the instance configuration
is changed, verify these settings manually.

**What this project configures**:
- The SSH key is stored in GitHub Secrets (`EC2_SSH_KEY`) and in a password manager
- Security Group allows inbound on ports 443, 80, and 22

Residual risk: the instance is reachable on port 22 from any IP. An attacker would need to
compromise the private key or exploit an OpenSSH vulnerability. To reduce exposure:
- Keep the instance patched (`sudo dnf update -y`)
- Monitor auth logs (`/var/log/secure`) for unexpected access attempts

### Useful Commands

```bash
docker compose logs -f api                              # Stream API logs
docker compose restart api                              # Restart API
docker compose pull && docker compose up -d             # Manual deploy
docker compose run --rm api npx prisma migrate deploy   # Run migrations
```

## Cloud Run Setup

```bash
gcloud auth login
gcloud config set project fs-suite
./infra/cloudrun/setup.sh
```

### GCP Authentication Strategy

**Recommended: Workload Identity Federation (WIF)**

WIF provides keyless authentication from GitHub Actions to GCP — no long-lived JSON credentials
to manage, rotate, or risk leaking. To set up:

```bash
./infra/cloudrun/setup-wif.sh
```

Then add GitHub Secrets `GCP_WIF_PROVIDER` and `GCP_WIF_SERVICE_ACCOUNT`.

**Legacy: `GCP_SA_KEY`**

The deploy workflow also accepts a service account JSON key (`GCP_SA_KEY`). This is a legacy
approach — it works but introduces a long-lived credential that must be rotated manually.

The workflow passes both WIF and `GCP_SA_KEY` parameters to `google-github-actions/auth@v2`.
The precedence behavior between them is determined by that action, not by this project.
Now that WIF is active, `GCP_SA_KEY` has been removed from GitHub Secrets. If the workflow
is forked or WIF breaks, `GCP_SA_KEY` can be re-added as a fallback — the workflow accepts
it without changes.

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
│          │  Shared Supabase database — runs once
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
Migrations run against the shared Supabase database before any runtime is updated.

### Workflows

| Workflow | Trigger | Action |
|----------|---------|--------|
| `ci.yml` | Push to `main` + PRs | Install, lint, typecheck, build, test |
| `deploy.yml` | Push to `main` (API/packages paths) | Build → migrate → deploy EC2 + Cloud Run |
| `deploy-app.yml` | Push to `main` (app/UI paths) | Expo web export → Cloudflare Pages |
| `db-backup.yml` | Daily 03:00 UTC + manual | `pg_dump` → Supabase Storage (90-day retention) |
| `metrics-digest.yml` | Daily 07:00 UTC + manual | Fetch `/v1/admin/metrics` → post comment on the open metrics issue |

### GHCR Authentication

- **Setup (one-time)**: PAT with `read:packages` scope, used during `setup.sh`
- **Automated deploys**: `GITHUB_TOKEN` from Actions, passed via SSH to EC2

## Secrets

Secrets are grouped by **who consumes them**, not by where they happen to be
stored. The canonical source is your local `.env` (kept in a password manager).
Every other surface is a *derived copy* refreshed by a script — never edited by
hand.

### Categories

| # | Category | Consumer | Lives in `.env`? | Replicates to |
|---|----------|----------|------------------|---------------|
| A | API runtime | NestJS process | Yes | EC2 `/opt/fs-suite/.env` (`infra/ec2/setup.sh`); GCP Secret Manager (`infra/cloudrun/setup.sh`) |
| B | Frontend build | Expo export | Yes (`EXPO_PUBLIC_*`) | GitHub Secrets (`infra/bootstrap-github-secrets.sh`); injected into Expo build at deploy time |
| C | CI/CD pipeline auth | Actions runner | No | GitHub Secrets only — these authenticate the pipeline itself (chicken-and-egg) |
| D | Workflow data | Actions runner (direct, not via API) | Yes | GitHub Secrets (`infra/bootstrap-github-secrets.sh`) |

### Master matrix

| Secret | Cat | API needs it | Frontend needs it | Workflow needs it directly |
|--------|-----|--------------|-------------------|----------------------------|
| `DATABASE_URL` | A + D | ✅ | — | ✅ (`db-backup.yml`) |
| `REDIS_URL` | A | ✅ | — | — |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | A | ✅ | — | — |
| `ENCRYPTION_KEY` | A | ✅ | — | — |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | A | ✅ | — | — |
| `SENTRY_DSN` | A | ✅ | — | — |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | A | ✅ | — | — |
| `OWM_API_KEY` | A (optional) | if precipitation tiles enabled | — | — |
| `AVWX_TOKEN` | A (optional) | if enriched METAR enabled | — | — |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | A | ✅ | — | — |
| `ADMIN_METRICS_TOKEN` | A + D | ✅ | — | ✅ (`metrics-digest.yml`) |
| `SUPABASE_SERVICE_ROLE_KEY` | D | — | — | ✅ (`db-backup.yml`) |
| `EXPO_PUBLIC_POSTHOG_KEY` → `POSTHOG_KEY` | B | — | ✅ | ✅ (injected at build by `deploy-app.yml`) |
| `EC2_HOST` / `EC2_SSH_KEY` / `EC2_USER` | C | — | — | ✅ (`deploy.yml`) |
| `GCP_PROJECT_ID` / `GCP_WIF_PROVIDER` / `GCP_WIF_SERVICE_ACCOUNT` | C | — | — | ✅ (`deploy.yml`) |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | C | — | — | ✅ (`deploy-app.yml`) |
| `TURBO_TEAM` / `TURBO_TOKEN` | C | — | — | ✅ (`ci.yml` remote cache) |

Notes on JWT keys: regenerated on every `infra/ec2/setup.sh` run (EC2 is the
canonical source), then captured into GCP Secret Manager by
`infra/cloudrun/setup.sh`. They do not live in your local `.env`.

### Provisioning a fresh environment

Starting from just your `.env`, all three runtime surfaces are populated:

```bash
# 1. EC2 — propagates every API-runtime secret from .env automatically
scp .env origin.pem origin-key.pem fs-suite:~/
ssh fs-suite './setup.sh'

# 2. Cloud Run — paste each value when prompted (script reads the same .env)
./infra/cloudrun/setup.sh

# 3. GitHub Secrets — categories B + D, derived from .env
./infra/bootstrap-github-secrets.sh /path/to/.env
```

Category C (pipeline auth) is set once when first wiring up CI/CD and rarely
changes. See [Cloud Run Setup](#cloud-run-setup) and the SSH key step in
[EC2 Setup](#ec2-setup).

### Description of each secret

| Secret | Description |
|--------|-------------|
| `DATABASE_URL` | Supabase Supavisor session-mode pooler URL (port 5432 on `aws-1-eu-central-1.pooler.supabase.com`). Required because Supabase's direct endpoint is IPv6-only and our runtimes don't route IPv6. Session mode supports prepared statements and advisory locks, so it works for both Prisma Client and Prisma Migrate without a separate `DIRECT_URL`. The `db-backup.yml` workflow strips the query string and replaces it with `sslmode=require`, so any query params are tolerated. |
| `REDIS_URL` | Upstash Redis connection string (`rediss://` for TLS). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials. |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | RS256 keypair. Auto-generated by `infra/ec2/setup.sh` (not in your `.env`); regenerating invalidates existing tokens — users re-login. |
| `ENCRYPTION_KEY` | AES-256-GCM 32-byte hex key. Persistent — regenerating breaks all encrypted OAuth tokens and BYOK API keys. |
| `SENTRY_DSN` | Backend Sentry project DSN. |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | Free-tier AI provider keys for flight-plan validation. |
| `OWM_API_KEY` | OpenWeatherMap key — precipitation tile proxy. Optional; not currently wired into `deploy.yml --set-secrets`. If you start using it, create `owm-api-key` in GCP Secret Manager and add the mapping to `deploy.yml`. |
| `AVWX_TOKEN` | AVWX token — enriched METAR decoding. Same caveat as `OWM_API_KEY`. |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare R2 credentials for chart overlay cache. |
| `ADMIN_METRICS_TOKEN` | Header-token auth for `GET /v1/admin/metrics` (consumed by `metrics-digest.yml`). Generate with `openssl rand -hex 32`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role JWT from Supabase dashboard → Settings → API. Used by `db-backup.yml` to upload dumps to Supabase Storage. |
| `EXPO_PUBLIC_POSTHOG_KEY` (`.env`) → `POSTHOG_KEY` (GH Secret) | PostHog project key. **Frontend only** — embedded into the Expo web bundle at build time via `deploy-app.yml`. The API does not use PostHog. |
| `EC2_HOST` / `EC2_SSH_KEY` / `EC2_USER` | SSH access to the EC2 deploy target. |
| `GCP_PROJECT_ID` / `GCP_WIF_PROVIDER` / `GCP_WIF_SERVICE_ACCOUNT` | GCP project + Workload Identity Federation for Cloud Run deploy. `GCP_SA_KEY` is the legacy fallback; remove once WIF is active. |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Pages deploy credentials. |
| `TURBO_TEAM` / `TURBO_TOKEN` | Turborepo remote cache (optional). |

**Deprecated**: `GCP_REGION` (hardcoded to `europe-west2`), `BACKUP_DATABASE_URL` (replaced by `DATABASE_URL`).

**Never commit real secrets.**

## Metrics Digest

A daily snapshot of operational metrics (DB size vs Supabase cap, Redis memory
vs Upstash cap, users, plans, sessions, activity, AI usage, chart-overlay
cache) is posted as a comment on a single open GitHub issue labelled `metrics`.
The issue is auto-created on first run; GitHub emails subscribers on each new
comment.

`metrics-digest.yml` runs daily at 07:00 UTC (and via `workflow_dispatch`). It
calls `GET /v1/admin/metrics` with the `X-Admin-Token` header; the API gates
the endpoint by comparing the header to `process.env.ADMIN_METRICS_TOKEN`. The
shared token lives in your `.env` (category A + D) and is replicated to EC2,
GCP Secret Manager, and GitHub Secrets by the scripts in
[Provisioning](#provisioning-a-fresh-environment).

```bash
# Manual run (after a provisioning change, for example):
gh workflow run metrics-digest.yml
```

## Failover: EC2 → Cloud Run

Cloud Run is always deployed in parallel and ready to serve traffic.

### Activate candidate

1. In Cloudflare DNS, change `api.fs-suite.com`:
   - Delete the A record pointing to EC2 Elastic IP
   - Create a CNAME pointing to the Cloud Run URL (from `gcloud run services describe fs-suite-api --region europe-west2 --format 'value(status.url)'`)
   - Or switch the app to use `api-candidate.fs-suite.com` directly
2. Verify: `curl https://api.fs-suite.com/v1/health`

Note: Cloud Run runs with `min-instances: 0`. The first request after failover may experience
a cold start (typically 5–10s). Subsequent requests are served normally.

### Return to primary

1. In Cloudflare DNS, change `api.fs-suite.com` back:
   - Delete the CNAME
   - Create A record → `52.18.13.237` (Proxied)
2. Verify: `curl https://api.fs-suite.com/v1/health`

### What stays intact during failover

- Database (Supabase) — shared, no migration needed
- Redis (Upstash) — shared, sessions persist
- OAuth callbacks — `GOOGLE_CALLBACK_URL` points to `api.fs-suite.com` on both runtimes
- Secrets — independent copies (`.env` on EC2, Secret Manager on GCP)

### What changes on EC2 reprovisioning

If the EC2 instance is replaced and `setup.sh` runs again, a new JWT keypair is generated.
All existing access and refresh tokens become invalid — users must sign in again via Google
OAuth. No other data or integrations are affected. See [JWT Keys](#jwt-keys) for rationale.

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
| Candidate health | `curl https://api-candidate.fs-suite.com/v1/health` | `{"status":"ok"}` |
| Auth flow | Sign in at `https://fs-suite.com` | Google OAuth completes |
| DB connectivity | Check API logs for Prisma errors | No connection errors |
| Redis connectivity | Check API logs for Redis errors | No connection errors |
| Container status | `ssh fs-suite 'docker compose -f /opt/fs-suite/docker-compose.yml ps'` | Both healthy |

## Operational Decisions

Summary of deliberate tradeoffs accepted at the current product stage.

| Decision | Tradeoff | Rationale |
|----------|----------|-----------|
| JWT keypair generated on setup | Users re-login after reprovisioning | Avoids managing keypair as a separate persistent secret |
| SSH port 22 open to `0.0.0.0/0` | Broader attack surface on SSH | GitHub Actions runners have unpredictable IPs; key-only auth mitigates |
| `ENCRYPTION_KEY` is a persistent secret | Must be preserved across reprovisions | Regenerating would break encrypted OAuth tokens and BYOK API keys |
| Cloud Run `min-instances: 0` | Cold start on first request after failover | Keeps candidate runtime at zero cost when not in use |
| GCP auth via WIF (active) | Requires OIDC setup on GCP | Keyless auth; `GCP_SA_KEY` removed but workflow still accepts it if re-added |
