# FS Suite

Flight simulation planning and management platform built for the [Simulando](https://simulando.com.br) community. Provides virtual pilots with a unified experience for flight planning, operational consultation, and integrations with established ecosystem tools (SimBrief, SkyVector).

## Features

- **VFR/IFR Flight Planning** — origin/destination, aircraft profile, route, visual references, checklists
- **Aircraft Profiles** — reusable configurations for cruise speed, fuel unit, and ICAO type
- **SimBrief Integration** — import OFP (Operational Flight Plan) data
- **SkyVector Integration** — contextual route visualization links
- **Aerodrome Charts** — embedded PDF viewer with DECEA/AIS chart sources
- **Weather (METAR/TAF)** — real-time weather briefing for departure/arrival
- **REA (Restricted Airspace)** — NOTAMs and airspace events overlay
- **Google OAuth** — secure authentication with session management
- **Internationalization** — pt-BR and en-US

## Architecture

Turborepo monorepo with shared packages across frontend and backend:

```
fs-suite/
├── apps/
│   ├── api/           # NestJS REST API
│   └── app/           # Expo (web + mobile) frontend
├── packages/
│   ├── ui/            # Shared design system (NativeWind)
│   ├── types/         # Shared Zod schemas and TypeScript types
│   └── config/        # Shared ESLint, TypeScript, and Tailwind configs
├── infra/             # Kubernetes manifests (Kustomize)
└── docs/              # Product and technical specifications
```

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Expo + React Native | 51.x / 0.74 |
| Backend | NestJS | 10.x |
| Database | PostgreSQL + Prisma ORM | 16 / 5.x |
| Cache | Redis | 7.x |
| Language | TypeScript | 5.x |
| Monorepo | Turborepo + pnpm | 2.x / 9.x |
| Auth | Passport.js (Google OAuth 2.0) | 0.7 |
| Validation | Zod + class-validator | 3.x / 0.14 |
| UI Styling | NativeWind (Tailwind CSS) | 4.x |
| Maps | Leaflet | 1.9 |
| i18n | i18next | 23.x |
| State | Zustand | 4.x |
| HTTP Client | TanStack React Query | 5.x |
| Error Tracking | Sentry | 10.x |
| Testing | Vitest + Playwright | 1.x |

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (`corepack enable && corepack prepare pnpm@9.15.9 --activate`)
- Docker (for local PostgreSQL and Redis)

## Getting Started

```bash
# Clone
git clone https://github.com/alexandre3gomes/fs-suite.git
cd fs-suite

# Install dependencies
pnpm install

# Start local databases
docker compose up -d

# Configure environment
cp apps/api/.env.example apps/api/.env
cp apps/app/.env.example apps/app/.env
# Edit .env files with your Google OAuth credentials and JWT keys

# Run database migrations and seed
cd apps/api
npx prisma migrate dev
npx prisma db seed
cd ../..

# Start all services
pnpm dev
```

The API runs on `http://localhost:3001` and the Expo web app on `http://localhost:8081`.

## Development Commands

```bash
# Root (all apps via Turborepo)
pnpm dev              # Start all services in watch mode
pnpm build            # Build all packages
pnpm lint             # Lint all packages
pnpm typecheck        # Type-check all packages
pnpm test             # Run tests
pnpm format           # Format with Prettier
pnpm format:check     # Check formatting

# API only
pnpm --filter @fs-suite/api dev
pnpm --filter @fs-suite/api prisma:migrate
pnpm --filter @fs-suite/api prisma:seed

# App only
pnpm --filter @fs-suite/app dev
pnpm --filter @fs-suite/app build:web
```

## API Modules

| Module | Purpose |
|--------|---------|
| `auth` | Google OAuth, JWT sessions, token refresh |
| `users` | User profile management |
| `aircraft-profiles` | Aircraft configuration CRUD |
| `airports` | Airport search, runway data, chart proxy |
| `flight-plans` | IFR/VFR flight plan CRUD with duplication |
| `vfr-flight-plans` | VFR-specific planning (visual references, briefing, checklists) |
| `integrations/simbrief` | SimBrief OFP import |
| `integrations/skyvector` | SkyVector route link generation |
| `weather` | METAR/TAF retrieval |
| `rea` | Restricted airspace and NOTAMs |
| `health` | Liveness/readiness probes |

Swagger docs available at `GET /v1/docs` when running locally.

## Database Schema

Key entities:

- **User** / **OAuthAccount** / **Session** — authentication and identity
- **AircraftProfile** — user-defined aircraft configurations
- **Airport** / **Runway** — aviation database
- **FlightPlan** / **FlightPlanRoute** — IFR flight planning
- **VfrFlightPlan** / **VfrFlightPlanVisualReference** / **VfrFlightPlanBriefingItem** — VFR planning
- **IntegrationConnection** — third-party service links (SimBrief)
- **ActivityLog** — audit trail

OAuth tokens are encrypted at rest (AES-256-GCM). Soft deletes for LGPD compliance.

## Environment Variables

See [`apps/api/.env.example`](apps/api/.env.example) and [`apps/app/.env.example`](apps/app/.env.example) for the full list.

Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | RS256 keypair for JWT signing |
| `ENCRYPTION_KEY` | AES-256-GCM key (32-byte hex) |
| `WEB_ORIGIN` | Allowed CORS origin |
| `EXPO_PUBLIC_API_URL` | API base URL for the frontend |

## CI/CD

GitHub Actions workflows on push to `main`:

| Workflow | Trigger paths | Action |
|----------|--------------|--------|
| `ci.yml` | All code | Lint, typecheck, build, test |
| `deploy.yml` | `apps/api/`, `infra/`, `packages/` | Build Docker (ARM64) → GHCR → K8s rollout |
| `deploy-app.yml` | `apps/app/`, `packages/ui/`, `packages/types/` | Expo web export → Cloudflare Pages |

## Production Infrastructure

| Component | Service |
|-----------|---------|
| Frontend | Cloudflare Pages (`fs-suite.com`) |
| API | K3s on OCI VM (`api.fs-suite.com`) |
| Database | Neon (serverless PostgreSQL) |
| Cache | Upstash (serverless Redis, TLS) |
| DNS/SSL | Cloudflare (automatic TLS, auto-renew) |
| Container Registry | GitHub Container Registry (GHCR) |

See [`infra/README.md`](infra/README.md) for detailed infrastructure documentation.

## Project Structure Conventions

- **Code and technical docs**: English
- **User-facing content**: Brazilian Portuguese (pt-BR)
- **Visual identity**: aviation/cockpit aesthetic
- **Branching**: feature branches → PR → merge to `main`
- **Specs**: `docs/project-spec.md` (product) and `docs/technical-spec.md` (technical)

## License

Private project. All rights reserved.
