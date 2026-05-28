# CLAUDE.md

## Project Overview

**FS Suite** is a flight simulation planning and management platform built for the "Simulando" channel community. It provides virtual pilots with a unified experience for flight planning, operational consultation, and integrations with established ecosystem tools (SimBrief, SkyVector).

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
├── infra/         # Cloud Run setup scripts and deployment config
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
| Hosting     | Cloudflare Pages (frontend), EC2 primary + Cloud Run candidate (API) |
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

| Service     | Status | Purpose                                  |
|-------------|--------|------------------------------------------|
| SimBrief    | Active | Import OFP flight plan data              |
| SkyVector   | Active | Contextual route and airport visualization |
| DECEA/AIS   | Active | Aerodrome charts (ADC, VAC, PDC)         |
| FlightAware | Future | Flight tracking and operational reference |

## Production URLs

| Service | URL |
|---------|-----|
| Frontend | https://fs-suite.com |
| API | https://api.fs-suite.com |

## Specifications

- Product specification: `docs/project-spec.md` (Portuguese)
- Technical specification: `docs/technical-spec.md`
- VFR planning specification: `docs/vfr-flight-planning-spec.md`
