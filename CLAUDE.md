# CLAUDE.md

## Project Overview

**FS Suite** is a flight simulation planning and management platform built for the virtual aviation community. It provides virtual pilots with a unified experience for flight planning, operational consultation, and integrations with established ecosystem tools (SimBrief, SkyVector).

## Architecture

Turborepo monorepo:

```
fs-suite/
├── apps/
│   ├── api/       # NestJS — REST API, business logic, integrations
│   └── app/       # Expo — React Native (web + iOS + Android)
├── packages/
│   ├── ui/        # Shared design system (NativeWind components)
│   ├── types/     # Shared Zod schemas and TypeScript types
│   └── config/    # Shared ESLint, TypeScript, and Tailwind configs
├── infra/         # EC2 deployment config and provisioning scripts
└── docs/          # Product and technical specifications
```

## Tech Stack

| Layer       | Technology                           |
|-------------|--------------------------------------|
| Frontend    | Expo + React Native (TypeScript)     |
| Backend     | NestJS (TypeScript)                  |
| Database    | PostgreSQL 16 + Prisma ORM           |
| Cache       | Redis 7                              |
| Auth        | Google OAuth 2.0 (Passport.js)       |
| Monorepo    | Turborepo + pnpm                     |
| CI/CD       | GitHub Actions                       |
| Hosting     | Cloudflare Pages (frontend), EC2 (API) |
| DNS/TLS     | Cloudflare (proxied, Full Strict)    |

## Development Commands

```bash
pnpm dev              # Start all services (Turborepo)
pnpm build            # Build all packages
pnpm lint             # Lint all packages
pnpm typecheck        # Type-check all packages
pnpm test             # Run tests
pnpm format           # Format with Prettier

# Single app
pnpm --filter @fs-suite/api dev
pnpm --filter @fs-suite/app dev
```

## Local services (Docker)

`docker compose up -d` starts Postgres, Redis, and **MinIO** (S3-compatible
object storage). MinIO stands in for Cloudflare R2 locally — the chart-overlay
cache and feedback attachments — so dev never hits real R2 or the API's disk.
The same `@aws-sdk/client-s3` path is exercised; the API points at it via
`R2_ENDPOINT=http://localhost:9000` (see `apps/api/.env.example`). Buckets
(`fs-suite-charts`, `communications`) are auto-created by the `minio-setup`
one-shot. Console: http://localhost:9001 (user/pass `fssuite` /
`fssuite_dev_secret`). The API does **not** read `communications` at runtime —
it exists only for parity with the Supabase bucket used outside the API.

**Email in dev:** the central `MailerService` only sends via Resend when
`NODE_ENV === 'production'`. Outside prod it **captures** every email into an
in-memory dev inbox instead of sending — view the rendered HTML at
http://localhost:3001/v1/dev/emails. Force a real send from dev with
`MAIL_FORCE_SEND=true` (needs `RESEND_API_KEY`).

## Remote dev environment (WSL)

`scripts/dev-remote/` runs the heavy stack (Postgres, Redis, NestJS API) on a
remote WSL box while the laptop only edits code and runs Expo Metro. Useful when
the laptop is resource-constrained.

```bash
./scripts/dev-remote/push.sh   # snapshot working tree → origin/dev → WSL sync
```

The script force-pushes a transient `wip(dev): ...` commit to `origin/dev` using
git plumbing (`write-tree` + `commit-tree`) — HEAD does not move and the active
branch stays clean. On the remote, `sync.sh` pulls, installs deps on lockfile
change, builds shared packages, runs Prisma migrations, restarts the API in a
tmux session, and opens an SSH tunnel `localhost:3001 → WSL:3001` for OAuth
callbacks. The `dev` branch is never merged into `main` — `main...dev` on GitHub
shows the live diff between prod and the WSL test environment.

## Development Guidelines

- Language for code and technical documentation: **English**
- User-facing content language: **Brazilian Portuguese** (pt-BR)
- Visual identity: aviation/cockpit aesthetic — avoid generic SaaS dashboard look
- LGPD compliance in data modeling (soft deletes, token encryption)
- Observability via Sentry error tracking and activity logging

## External Integrations

| Service     | Status   | Purpose                                  |
|-------------|----------|------------------------------------------|
| SimBrief    | Active   | Import OFP flight plan data              |
| SkyVector   | Active   | Contextual route and airport visualization |
| DECEA/AIS   | Active   | Aerodrome charts (ADC, VAC, PDC)         |
| Resend      | Active   | Feedback emails (admin notifications + replies to users); reserved for future marketing comms |
| FlightAware | Future   | Flight tracking and operational reference |

## Admin area & user communications

The in-app admin area (gated by `User.isAdmin`, with the `ADMIN_EMAILS`
allow-list as a bootstrap fallback) covers **user management** (list users,
grant/revoke admin, soft-delete accounts) and **feedback triage**.

- **Admin access** is a persisted `User.isAdmin` flag, toggled from the admin
  area. `ADMIN_EMAILS` (`auth/admin-emails.ts`) are always admin so the instance
  can't be locked out. `GET /users/me` returns the effective `isAdmin`. Effective
  admin recipients for operational email come from the shared
  `getAdminRecipients()` helper (`auth/admin-recipients.ts`).
- **User feedback** (`feedback` module — see `docs/feedback-feature-spec.md`):
  any authenticated user submits a bug report or suggestion from the header
  (modal, no navigation), optionally with attachments (≤3 files, ≤5 MB,
  png/jpeg/webp/pdf — validated by magic bytes, images re-encoded, stored
  private in R2 under `feedback/`). Admins triage at `/admin/feedback`, reply
  (emails the user via Resend), and mark resolved. New feedback emails all
  admins. These emails are **transactional** (no marketing-consent gate).
- **Marketing audience (broadcasts):** users are mirrored into a Resend
  Audience for feature announcements — created on signup, `unsubscribed` tracks
  `marketingEmailConsent`, removed on account deletion (`ResendAudienceService`,
  gated to prod). Contacts carry `language` (`pt-BR`/`en`, from `User.locale`)
  and `is_admin` custom properties for segmentation. The DB is the source of
  truth; a Svix-signed webhook
  (`POST /v1/email/webhooks/resend`) reflects audience-side unsubscribes/spam
  complaints back into the DB. Backfill via `POST /v1/admin/audience/sync`.
  Users keep the `marketingEmailConsent` opt-in (default true) + one-click LGPD
  unsubscribe (`GET /v1/email/unsubscribe`). (Feedback emails are operational
  and do not use this gate.)

## Production URLs

| Service | URL |
|---------|-----|
| Frontend | https://fs-suite.com |
| API | https://api.fs-suite.com |

## Specifications

- Product specification: `docs/project-spec.md` (Portuguese)
- Technical specification: `docs/technical-spec.md`
- VFR planning specification: `docs/vfr-flight-planning-spec.md`
