# Infrastructure — FS Suite

API runs on EC2 (the only paid resource; everything else is free-tier).
Build once on GitHub Actions, deploy to EC2.

## Structure

```
infra/
├── ec2/
│   ├── docker-compose.yml   # Production services: nginx (TLS) + api
│   ├── .env.example         # Template for required environment variables
│   └── setup.sh             # File-driven one-time EC2 provisioning
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
     ┌──────────┴──────────┐
     │                     │
fs-suite.com         api.fs-suite.com
     │                     │
  CF Pages           EC2 t3.small
  (static)           eu-west-1
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
| API | EC2 t3.small | Production | Amazon Linux 2023, `eu-west-1` |
| Database | Supabase | Shared | PostgreSQL, `eu-central-1`, accessed via Supavisor session-mode pooler (IPv4) |
| Cache | Upstash | Shared | Serverless Redis, TLS |
| DNS/TLS | Cloudflare | Edge | Proxied, Full (Strict) mode |

### Container Registry

| Registry | Used by | Image |
|----------|---------|-------|
| GHCR | EC2 | `ghcr.io/alexandre3gomes/fs-suite-api` |

### Secrets Management

| Runtime | Where | How |
|---------|-------|-----|
| EC2 | `/opt/fs-suite/.env` | File on disk, `chmod 600` |

### DNS Records

| Record | Type | Target | Proxy |
|--------|------|--------|-------|
| `fs-suite.com` | CNAME | `fs-suite-app.pages.dev` | Proxied |
| `api.fs-suite.com` | A | EC2 Elastic IP (`52.18.13.237`) | Proxied |

**Email sending (Resend).** Resend powers the **feedback feature** — admin
notifications on new feedback and replies sent to users (operational email,
default sender `feedback@fs-suite.com`). It is also **reserved for future
marketing/user communications**. To send from `@fs-suite.com`, verify the domain
in Resend and add the records it generates to Cloudflare (all **DNS-only /
unproxied**):

| Record | Type | Notes |
|--------|------|-------|
| `resend._domainkey.fs-suite.com` (and any extra `*._domainkey`) | TXT/CNAME | DKIM — exact values from the Resend dashboard. |
| `send.fs-suite.com` (Return-Path) | MX + TXT (SPF) | Bounce/Return-Path subdomain; `MX → feedback-smtp.<region>.amazonses.com`, `TXT "v=spf1 include:amazonses.com ~all"`. |

These are **send-only** and coexist with the iCloud Custom Domain **MX** records
that receive mail for `@fs-suite.com` — Resend uses the `send.` subdomain, so the
apex MX (iCloud) is untouched.

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
5. Sets up the JWT RS256 keypair: preserves the pair from your `.env` if
   populated, generates a fresh one on first provision (see [JWT Keys](#jwt-keys))
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

The JWT RS256 keypair lives in the canonical `.env` (your password
manager) and is propagated to EC2 by `infra/ec2/setup.sh`.

**First-time provisioning** (`JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` blank
in canonical `.env`):

1. Run `infra/ec2/setup.sh` — it detects the absence and generates a
   fresh RS256 2048-bit pair, writing both to `/opt/fs-suite/.env`.
2. The script prints the exact `ssh` command to capture them back:

   ```bash
   ssh fs-suite "sudo grep -E '^JWT_(PRIVATE|PUBLIC)_KEY=' /opt/fs-suite/.env"
   ```

3. Paste both lines into the canonical `.env` (Bitwarden).

**Subsequent reprovisioning** (`JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`
populated in canonical `.env`): EC2 setup detects the existing values
in the propagated `.env` and skips generation. Sessions issued before
the reprovisioning continue to validate — **no user re-login required**.

**If you want to force a regenerate** (e.g. you suspect the private key
was leaked): clear both fields in the canonical `.env`, run EC2 setup
(generates fresh keys), capture back. Every active session is
invalidated; users must sign in again via Google OAuth. No data is lost.

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

## CI/CD

Branching model: **feature branches → PR → merge to main**.

### Deploy Pipeline

```
push to main
    │
    ▼
┌─────────┐
│  Build  │  Build Docker image once, push to GHCR
└────┬────┘
     │
     ▼
┌──────────┐
│ Migrate  │  prisma migrate deploy (via EC2 SSH)
│          │  Shared Supabase database — runs once
└────┬─────┘
     │
     ▼
┌──────────┐
│ Deploy   │
│ EC2 (SSH)│
└──────────┘
```

**Rollout order**: build → migrate → deploy EC2. Migrations run against
the shared Supabase database before the runtime is updated.

### Workflows

| Workflow | Trigger | Action |
|----------|---------|--------|
| `ci.yml` | Push to `main` + PRs | Install, lint, typecheck, build, test |
| `deploy.yml` | Push to `main` (API/packages paths) | Build → migrate → deploy EC2 |
| `deploy-app.yml` | Push to `main` (app/UI paths) | Expo web export → Cloudflare Pages |
| `db-backup.yml` | Daily 03:00 UTC + manual | `pg_dump` → Supabase Storage (90-day retention) |
| `db-restore-drill.yml` | Weekly Mon 04:00 UTC + manual | Pull latest dump, restore into ephemeral Postgres, run schema sanity. Opens issue on failure |
| `metrics-digest.yml` | Daily 07:00 UTC + manual | Email HTML digest via Resend to all DB admins |
| `smoke-test.yml` | Daily 06:30 UTC + manual + final step in every deploy | `scripts/smoke-test.sh` over api / frontend. Opens issue on failure |

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
| A | API runtime | NestJS process | Yes | EC2 `/opt/fs-suite/.env` (`infra/ec2/setup.sh`) |
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
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | A | ✅ | — | — _(see [JWT key flow](#jwt-keys))_ |
| `SENTRY_DSN` | A + B | ✅ | ✅ (injected as `EXPO_PUBLIC_SENTRY_DSN` at build time) | — |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | A | ✅ | — | — |
| `OWM_API_KEY` | A (optional) | if precipitation tiles enabled | — | — |
| `AVWX_TOKEN` | A (optional) | if enriched METAR enabled | — | — |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | A | ✅ | — | — |
| `ADMIN_METRICS_TOKEN` | A + D | ✅ | — | ✅ (`metrics-digest.yml`) |
| `RESEND_API_KEY` | A + D | ✅ (feedback emails) | — | ✅ (`metrics-digest.yml`) |
| `SUPABASE_SERVICE_ROLE_KEY` | D | — | — | ✅ (`db-backup.yml`) |
| `EXPO_PUBLIC_POSTHOG_KEY` → `POSTHOG_KEY` | B | — | ✅ | ✅ (injected at build by `deploy-app.yml`) |
| `EC2_HOST` / `EC2_SSH_KEY` / `EC2_USER` | C | — | — | ✅ (`deploy.yml`) |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | C | — | — | ✅ (`deploy-app.yml`) |
| `TURBO_TEAM` / `TURBO_TOKEN` | C | — | — | ✅ (`ci.yml` remote cache) |

Notes on JWT keys: the canonical `.env` is the source of truth. If the
keys are blank, `infra/ec2/setup.sh` generates a fresh RS256 pair on
first run; the operator then captures the generated values back into
the canonical `.env` (one-line `ssh` printed in the setup output). On
subsequent reprovisions with the values already in `.env`, EC2 picks
them up and existing JWT tokens stay valid. See
[JWT Keys](#jwt-keys) for the full flow.

### Provisioning a fresh environment

Your canonical `.env` (kept in Bitwarden, templated from
[`.env.example.production`](../.env.example.production)) is the single
input. All three runtime surfaces are populated from it:

```bash
# 1. EC2 — propagates every API-runtime secret from .env automatically
scp .env origin.pem origin-key.pem fs-suite:~/
ssh fs-suite './setup.sh'

# 2. GitHub Secrets — workflow data + frontend build, derived from .env
./infra/bootstrap-github-secrets.sh /path/to/.env
```

Category C (pipeline auth) is set once when first wiring up CI/CD and rarely
changes. See the SSH key step in [EC2 Setup](#ec2-setup).

For greenfield setup of the underlying managed services (Supabase, Upstash,
Cloudflare, Google OAuth, Sentry, PostHog), see the runbooks under
[`docs/greenfield/`](../docs/greenfield/). Each runbook is greenfield-first
with a "Reusing existing" callout at the top — if you already have the
service provisioned and credentials in hand, you can skip straight to the
"Capture credentials" section.

### Description of each secret

| Secret | Description |
|--------|-------------|
| `DATABASE_URL` | Supabase Supavisor session-mode pooler URL (port 5432 on `aws-1-eu-central-1.pooler.supabase.com`). Required because Supabase's direct endpoint is IPv6-only and our runtimes don't route IPv6. Session mode supports prepared statements and advisory locks, so it works for both Prisma Client and Prisma Migrate without a separate `DIRECT_URL`. The `db-backup.yml` workflow strips the query string and replaces it with `sslmode=require`, so any query params are tolerated. |
| `REDIS_URL` | Upstash Redis connection string (`rediss://` for TLS). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials. |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | RS256 keypair. Lives in the canonical `.env`. Generated by `infra/ec2/setup.sh` on first provision only; subsequent reprovisions reuse the values from `.env` (sessions stay valid). To force a rotation, clear both fields in `.env` before running setup. See [JWT Keys](#jwt-keys). |
| `ENCRYPTION_KEY` | AES-256-GCM 32-byte hex key. Persistent — regenerating breaks all encrypted OAuth tokens and BYOK API keys. |
| `SENTRY_DSN` | Sentry project DSN — shared by backend and frontend (`deploy-app.yml` injects it as `EXPO_PUBLIC_SENTRY_DSN` at Expo build time). Errors are separable in Sentry by SDK tag (`javascript` for web, `node` for API). |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | Free-tier AI provider keys for flight-plan validation. |
| `OWM_API_KEY` | OpenWeatherMap key — precipitation tile proxy. Optional; if you start using it, add it to the EC2 `.env`. |
| `AVWX_TOKEN` | AVWX token — enriched METAR decoding. Optional; same as `OWM_API_KEY`. |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare R2 credentials for the chart-overlay cache **and feedback attachments** (same bucket; attachments live under the `feedback/` key prefix). |
| `ADMIN_METRICS_TOKEN` | Header-token auth for `GET /v1/admin/metrics` (consumed by `metrics-digest.yml`). Generate with `openssl rand -hex 32`. |
| `RESEND_API_KEY` | [Resend](https://resend.com) API key. Used by the **feedback feature** (admin notifications + replies to users) and by `metrics-digest.yml` for the daily digest. Sender on the Resend-verified `fs-suite.com` domain. As a GitHub Actions secret it must be a Resend key (`re_…`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side full-access key (bypasses RLS). On the **new** Supabase key system this is the **secret key** (`sb_secret_…`) from dashboard → Settings → API Keys → Secret key; on legacy projects it's the `service_role` JWT. Used by `db-backup.yml` to upload DB dumps. (The API no longer uses Supabase — the communications screenshot storage was removed.) The env var name is kept for continuity even when the value is an `sb_secret_…` key. |

Non-secret config (plain env vars / GitHub Secrets, not app secrets):

| Var | Description |
|-----|-------------|
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | Optional sender/reply-to overrides, **reserved for future marketing communications** (Resend). The sender domain must be verified in Resend before use. |
| `FEEDBACK_EMAIL_FROM` / `FEEDBACK_EMAIL_REPLY_TO` | Optional overrides for the feedback feature's sender (defaults `FS Suite <feedback@fs-suite.com>` / `feedback@fs-suite.com`). Sender must be on the verified `fs-suite.com` domain. |
| `EXPO_PUBLIC_POSTHOG_KEY` (`.env`) → `POSTHOG_KEY` (GH Secret) | PostHog project key. **Frontend only** — embedded into the Expo web bundle at build time via `deploy-app.yml`. The API does not use PostHog. |
| `EC2_HOST` / `EC2_SSH_KEY` / `EC2_USER` | SSH access to the EC2 deploy target. |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Cloudflare credentials. Token must include scope **Account → Cloudflare Pages: Edit** (for `deploy-app.yml`). |
| `TURBO_TEAM` / `TURBO_TOKEN` | Turborepo remote cache (optional). |

**Deprecated**: `BACKUP_DATABASE_URL` (replaced by `DATABASE_URL`). The
GCP/Cloud Run candidate was decommissioned (2026-06) — `GCP_PROJECT_ID`,
`GCP_WIF_PROVIDER`, `GCP_WIF_SERVICE_ACCOUNT`, `GCP_SA_KEY` are no longer used.

**Never commit real secrets.**

## Metrics Digest

A daily snapshot of operational metrics is **emailed via Resend** as an
HTML digest (sender `metrics@fs-suite.com`). **Recipients are not
hard-coded** — they come from `GET /v1/admin/metrics` (`.admin_recipients`,
the union of persisted `User.isAdmin` accounts and the `ADMIN_EMAILS`
bootstrap list), so granting admin in the in-app user-management area
auto-subscribes that person to the digest. The signature logo is served
from the public Supabase `communications` bucket at `email/fs-suite-logo.png`.

`metrics-digest.yml` runs daily at 07:00 UTC (and via
`workflow_dispatch`). It calls `GET /v1/admin/metrics` with the
`X-Admin-Token` header; the API gates the endpoint by comparing the
header to `process.env.ADMIN_METRICS_TOKEN`. The shared token lives in
your `.env` (category A + D) and is replicated to EC2 and GitHub Secrets
by the scripts in [Provisioning](#provisioning-a-fresh-environment). The
email step needs `RESEND_API_KEY` set as a GitHub Actions secret.

```bash
# Manual run (after a provisioning change, for example):
gh workflow run metrics-digest.yml
```

### Metric definitions

Each line of the daily comment is computed from a specific source. Use
this table when the comment renders an unexpected value.

| Label in comment | What it counts | Source | Cap / threshold |
|---|---|---|---|
| **EC2 disk** | `df -h /` on the EC2 host: % used, total size, count of docker images (`docker images --filter dangling=false`). | SSH to EC2 from the workflow runner. | Investigate at >85% — extraction may start failing. |
| **Database** | `pg_database_size(current_database())` on the live Supabase Postgres, expressed in MB. | `prisma.$queryRaw` from the API. | 500 MB (Supabase free-tier project). |
| **Redis** | `used_memory` from Redis `INFO memory` (bytes → MB) and total key count from `DBSIZE`. | Upstash Redis via the live API connection. | 256 MB (Upstash free-tier instance). |
| **Users** | `total` = rows in `users`. `new in 7d` = rows where `created_at >= now() - 7d`. `active in 7d` = distinct `user_id`s in `activity_logs` over the last 7 days. | `prisma.user.count()`, `prisma.activityLog.findMany({ distinct: ['userId'] })`. | — |
| **Flight plans** | `total` = rows in `flight_plans`. `new in 7d` = rows where `created_at >= now() - 7d`. | `prisma.flightPlan.count()`. Soft-deleted rows are **included** in both counts (no `deletedAt IS NULL` filter). | — |
| **Sessions** | Rows in `sessions` where `expires_at >= now()`. Refresh-token sessions that are still valid. | `prisma.session.count()`. | — |
| **Activity** | Rows in `activity_logs` over the last 24h and last 7d windows. Events include `auth.login`, `auth.logout`, `flight_plan.created`, `simbrief.import`, `ai_validation.*`, etc. | `prisma.activityLog.count()`. | — |
| **AI validations (7d)** | Subset of activity rows in last 7d whose `action` starts with `ai_validation`. | `prisma.activityLog.count({ where: { action: { startsWith: 'ai_validation' }, createdAt: { gte: 7d } } })`. | — |
| **Chart overlay cache** | Rows in `aerodrome_chart_overlays` — the R2-backed cache of rendered chart PDFs. | `prisma.aerodromeChartOverlay.count()`. | R2 is pay-per-use; cap is operational (cost), not hard. |

All time windows are computed at the moment the endpoint is hit (rolling, not calendar). All counts include soft-deleted rows unless noted.

The implementation lives in [`apps/api/src/admin/admin.controller.ts`](../apps/api/src/admin/admin.controller.ts) — that file is the canonical source for "what does this number really mean". The comment in the digest links here so the reader can drill down.

## Monitoring & validation

| Layer | Tool | Cadence | Failure mode |
|---|---|---|---|
| Backups verified-restorable | `db-restore-drill.yml` | Weekly (Mon 04:00 UTC) | GitHub issue labelled `restore-drill-failure` |
| Reachability (api / frontend) | `smoke-test.yml` + post-deploy step | Daily 06:30 UTC + every deploy | GitHub issue labelled `smoke-failure`; fails the deploy run that triggered it |
| Operational metrics snapshot | `metrics-digest.yml` | Daily 07:00 UTC | HTML email via Resend to all DB admins |
| External uptime (every 5 min) | UptimeRobot | Every 5 minutes | Email / Slack / SMS — configured outside this repo, see [`docs/monitoring/uptimerobot.md`](../docs/monitoring/uptimerobot.md) |

`scripts/smoke-test.sh` is the reusable check core. Run locally:

```bash
./scripts/smoke-test.sh                 # api + frontend
./scripts/smoke-test.sh api             # only the API
./scripts/smoke-test.sh frontend        # only the Pages bundle
```

## Operational hygiene

### Disk on EC2

The `deploy.yml` workflow keeps **only the 3 newest unique
`fs-suite-api` images** on the EC2 host before every pull (current
plus 2 prior, for rollback). Each image is ~2 GB; without pruning the
host filled up in ~3 weeks. The running container is always tagged
`:latest` and is image #1 in the list, so it's never affected.

Prune is **count-based, not age-based**. A previous age-based policy
(`docker image prune --filter "until=168h"`) let images accumulate
during active deploy weeks before the 7-day cutoff kicked in. Switched
to count after the 2026-05-28 disk alert.

The buildx layer cache is pruned separately by age
(`docker builder prune -af --filter "until=168h"`) because it's pure
storage waste, not versioned artifacts.

`nginx:alpine` and any other infra images (Redis, Postgres in dev,
etc) are untouched by the prune — the filter is scoped to the
`fs-suite-api` repository.

The daily Metrics Digest also reports `EC2 disk: X% of YG · N docker
images`. If that figure trends up despite pruning, investigate before
it crosses ~85% — docker layer extraction starts failing silently when
the disk fills up.

To manually run the same prune (e.g. one-off cleanup outside a deploy):

```bash
REPO=ghcr.io/alexandre3gomes/fs-suite-api
ssh fs-suite "
  OLD_IDS=\$(sudo docker images '$REPO' --filter 'dangling=false' --format '{{.ID}}' \
    | awk '!seen[\$0]++' | tail -n +4)
  [ -n \"\$OLD_IDS\" ] && echo \"\$OLD_IDS\" | xargs sudo docker rmi -f
"
```

### Recovery — what NOT to do

If a deploy seems stuck or the container is running the wrong image:

- **Do NOT** run `docker image rm -f <image>:latest` without first
  confirming you can pull a replacement. If credentials are stale or the
  registry is unreachable, you have just deleted the only working image
  and the container will refuse to start.
- **Do NOT** run `docker logout` followed by a re-login with a different
  account on the EC2 — the persistent PAT credentials from `setup.sh`
  will be overwritten and automated pulls from GitHub Actions may still
  work but interactive pulls will need the original PAT re-applied.
- **DO** check `df -h /` first. The most common silent-failure cause is
  disk pressure, not credentials. If the host is at >85%, prune before
  doing anything else.
- **DO** capture the image digest before and after any pull
  (`docker image inspect IMG --format '{{.Id}}'`). The deploy workflow
  now does this automatically and fails loudly if the digest does not
  change. For manual interventions, do the same comparison by hand.

If recovery requires fetching the image and you do not have a PAT with
`read:packages` handy:

```bash
# From a machine where you can authenticate:
gh auth refresh -s read:packages
GH_TOKEN=$(gh auth token)

ssh fs-suite "
  echo '$GH_TOKEN' | sudo docker login ghcr.io -u <github-username> --password-stdin
  cd /opt/fs-suite
  sudo docker compose pull api
  sudo docker compose up -d api
"
```

> **Note (2026-06):** the Cloud Run candidate and its `api-candidate.fs-suite.com`
> Cloudflare Worker were decommissioned to keep cost at zero (EC2 is the only
> paid resource). EC2 is the sole API runtime. If a managed-runtime path is
> wanted later (e.g. to drop the always-on EC2 cost), it can be re-provisioned
> from scratch — but resolve the Cloud Run cold-start startup-probe behaviour
> first.

### What changes on EC2 reprovisioning

Nothing user-visible, as long as the canonical `.env` is up to date.
`setup.sh` preserves `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` from the
input `.env`, so active access and refresh tokens stay valid across
the swap. The only path that invalidates sessions is an intentional
JWT rotation (clear the two keys in `.env` before running setup, then
re-capture). See [JWT Keys](#jwt-keys) for the full flow.

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
| Auth flow | Sign in at `https://fs-suite.com` | Google OAuth completes |
| DB connectivity | Check API logs for Prisma errors | No connection errors |
| Redis connectivity | Check API logs for Redis errors | No connection errors |
| Container status | `ssh fs-suite 'docker compose -f /opt/fs-suite/docker-compose.yml ps'` | Both healthy |

## Operational Decisions

Summary of deliberate tradeoffs accepted at the current product stage.

| Decision | Tradeoff | Rationale |
|----------|----------|-----------|
| JWT keypair lives in canonical `.env` | Operator must capture the pair into `.env` after the first-ever EC2 setup | Single source of truth; reprovisions preserve sessions; intentional rotation is a single-line edit |
| SSH port 22 open to `0.0.0.0/0` | Broader attack surface on SSH | GitHub Actions runners have unpredictable IPs; key-only auth mitigates |
| `ENCRYPTION_KEY` is a persistent secret | Must be preserved across reprovisions | Regenerating would break encrypted OAuth tokens and BYOK API keys |
| EC2 is the only API runtime | No instant managed-runtime failover | Keeps cost at zero beyond the EC2 instance; the Cloud Run candidate was decommissioned (2026-06) |
