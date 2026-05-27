# Greenfield runbooks

Step-by-step provisioning of every managed service FS Suite depends on,
starting from a brand-new account with nothing created.

| Runbook                      | What it provisions                                                 | `.env` keys it produces |
|------------------------------|--------------------------------------------------------------------|-------------------------|
| [supabase.md](supabase.md)   | PostgreSQL 16 project + Supavisor pooler + Storage bucket          | `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| [upstash.md](upstash.md)     | Redis instance + TLS URL                                           | `REDIS_URL` |
| [cloudflare.md](cloudflare.md) | Zone DNS + Pages project + R2 bucket + Origin Certificate         | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, GH `CLOUDFLARE_*` |
| [gcp.md](gcp.md)             | GCP project + Cloud Run + Artifact Registry + Secret Manager + WIF | GH `GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`, `GCP_WIF_SERVICE_ACCOUNT` |
| [google-oauth.md](google-oauth.md) | OAuth 2.0 client + consent screen                            | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| [sentry.md](sentry.md)       | Sentry project + DSN + release tracking                            | `SENTRY_DSN` |
| [posthog.md](posthog.md)     | PostHog project + public project key                               | `EXPO_PUBLIC_POSTHOG_KEY` |

## How to use

**Each runbook is greenfield-first.** If you already have the service
provisioned and the credentials in hand, every page opens with a
"Reusing existing" callout — skip to the "Capture credentials" section
at the bottom and copy the values straight into your canonical `.env`.

The canonical `.env` template is [`.env.example.production`](../../.env.example.production)
at the repo root. Once populated, the three provisioning scripts
(`infra/ec2/setup.sh`, `infra/cloudrun/setup.sh`,
`infra/bootstrap-github-secrets.sh`) consume it and propagate the
values to every runtime surface.

## Suggested order

When provisioning from scratch:

1. **Cloudflare** (gives you the zone for everything else)
2. **Supabase** (DB connection string needed by every API runtime)
3. **Upstash** (Redis URL, same)
4. **Google OAuth** (depends on knowing the API hostname, which depends on Cloudflare DNS)
5. **GCP / Cloud Run** (uses everything above)
6. **Sentry**, **PostHog** (observability layer — can run last; not blockers)

After all runbooks complete, the canonical `.env` is ready and the
infra scripts can be run against any fresh EC2 + Cloud Run + GitHub
repo.
