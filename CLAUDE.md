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
| Hosting     | Cloudflare Pages (frontend), EC2 on AWS (API) |
| DNS/SSL     | Cloudflare (automatic TLS)           |

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
