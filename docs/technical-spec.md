# FS Suite — Technical Specification

> **Status:** Reviewed v0.4 — Cleared for implementation
> **Version:** 0.4
> **Derived from:** `docs/project-spec.md`
> **Changelog:** v0.4 — Section 19 BA decisions resolved: SimBrief import-only confirmed, aircraft source policy updated, SkyVector validation classified as pre-Phase-4 QA gate, branding source set to Simulando channel, and `next-intl` confirmed with `pt-BR` + `en`. v0.3 — fixed refresh token session lookup: refresh token is now a signed JWT containing sessionId, removing dependency on access token during rotation. v0.2 — addressed BA review feedback: SimBrief scope, refresh token policy, endpoint contract, branding requirements, optional infra classification, airport data sourcing
> **Language:** English (code and technical docs); Portuguese pt-BR (user-facing content)

---

## 1. Overview

This document translates the functional requirements from the FS Suite product specification into concrete technical decisions, architecture definitions, data models, API contracts, and infrastructure choices.

Functional requirements are owned by the product/business team and **must not be modified here**. This spec exists to serve those requirements and must be revised whenever functional requirements change.

---

## 2. Monorepo Structure

```
fs-suite/
├── apps/
│   ├── web/                   # Next.js 14 (App Router)
│   ├── api/                   # NestJS 10
│   └── mobile/                # Expo SDK 51 (React Native) — scaffolded, not implemented in MVP
├── packages/
│   ├── ui/                    # Shared component library (React + Tailwind)
│   ├── types/                 # Shared TypeScript types and Zod schemas
│   └── config/                # Shared ESLint, TypeScript, Tailwind, and Prettier configs
├── docs/
│   ├── project-spec.md        # Functional specification (do not modify)
│   └── technical-spec.md      # This document
├── turbo.json
├── package.json               # Root workspace
└── .env.example
```

---

## 3. Tech Stack Decisions

| Concern              | Technology                    | Version   | MVP Required | Rationale                                                         |
|----------------------|-------------------------------|-----------|--------------|-------------------------------------------------------------------|
| Web framework        | Next.js (App Router)          | 14.x      | Yes          | SSR, RSC, file-based routing, good DX for dashboards             |
| API framework        | NestJS                        | 10.x      | Yes          | Modular, decorator-based, DI container, good for domain isolation |
| Mobile (future)      | Expo React Native             | SDK 51    | Scaffold only| Managed workflow, shared types with web                           |
| Language             | TypeScript                    | 5.x       | Yes          | Strict mode across all packages                                   |
| ORM                  | Prisma                        | 5.x       | Yes          | Type-safe queries, migration management, good Postgres support    |
| Database             | PostgreSQL                    | 16        | Yes          | Relational, JSONB support for flexible route data                 |
| Cache                | Redis                         | 7.x       | Yes          | Rate limiting, short-TTL airport data cache, refresh token rotation|
| Auth                 | Passport.js (NestJS)          | —         | Yes          | Google OAuth 2.0 strategy; JWT for stateless API tokens           |
| Monorepo             | Turborepo                     | 2.x       | Yes          | Task caching, pipeline orchestration                              |
| Component styling    | Tailwind CSS                  | 3.x       | Yes          | Utility-first, consistent design tokens across web and mobile     |
| Schema validation    | Zod                           | 3.x       | Yes          | Shared between `packages/types`, API DTOs, and web form schemas   |
| Testing (unit)       | Vitest                        | 1.x       | Yes          | Fast, ESM-native, compatible with both Next.js and NestJS         |
| Testing (e2e)        | Playwright                    | 1.x       | Yes          | Browser-level e2e for critical auth and planning flows            |
| Error tracking       | Sentry                        | —         | Yes          | Browser + Node.js SDK; required from first deploy per spec        |
| Event logging        | Posthog (self-hosted optional)| —         | Recommended  | Product analytics; LGPD opt-out required. Not a blocker for MVP launch |
| Component docs       | Storybook                     | —         | Recommended  | Useful once design system matures; not required to ship MVP       |
| Container            | Docker + Docker Compose       | —         | Yes (local)  | Local dev environment (Postgres, Redis)                           |

> **Note on "Recommended" items:** Posthog and Storybook are proposed as infrastructure improvements, not functional requirements. They can be added post-MVP-launch without affecting user-facing features.

---

## 4. Application Architecture

### 4.1 `apps/api` — NestJS

Modules:

```
src/
├── auth/           # Google OAuth, JWT issue/refresh, session management
├── users/          # User profile CRUD, preferences
├── airports/       # Airport lookup by ICAO/name, data caching
├── flight-plans/   # FlightPlan CRUD, duplication, history
├── integrations/
│   ├── simbrief/   # SimBrief OFP import adapter (generation pending validation — see Section 8)
│   └── skyvector/  # SkyVector contextual URL builder
├── activity/       # ActivityLog writes
└── common/         # Guards, interceptors, filters, decorators
```

**Authentication flow:**
1. Web client redirects to `/auth/google` (NestJS Passport redirect)
2. Google callback hits `/auth/google/callback`
3. NestJS creates or updates `User` + `OAuthAccount` records
4. Creates a `Session` row; issues a short-lived JWT access token (15 min) and a refresh token JWT (30 days) containing the `sessionId` as the `sid` claim — only the bcrypt hash of the raw refresh token is stored in `Session.refreshTokenHash` (see Section 10 for full token policy)
5. Raw refresh token sent as `httpOnly; Secure; SameSite=Strict` cookie; access token returned in JSON response body
6. `/auth/refresh` rotates both tokens using `sid` from the refresh token to locate the session — no access token required (see Section 10)

**API contract style:** REST, JSON. Versioned under `/v1/`. OpenAPI spec auto-generated via `@nestjs/swagger`.

### 4.2 `apps/web` — Next.js

Route structure:

```
app/
├── (public)/
│   └── login/          # Google OAuth entry point
├── (auth)/
│   ├── dashboard/       # Authenticated home
│   ├── flight-plans/
│   │   ├── new/         # New flight plan form
│   │   ├── [id]/        # View/edit saved plan
│   │   └── page.tsx     # History list
│   └── profile/         # User profile and preferences
└── api/
    └── auth/            # Next.js API route for token relay (if needed)
```

**State management:** React Server Components for data fetching where possible; Zustand for client-side UI state (form steps, modal state). No Redux.

**Data fetching:** Server Components fetch from NestJS API directly via internal network in production. Client Components use SWR for revalidation.

**Auth on web:** JWT stored in memory (access token); refresh token in `httpOnly` cookie managed by NestJS. Next.js middleware validates session on protected routes.

### 4.3 `packages/types`

Single source of truth for:
- Zod schemas (validated at runtime in API DTOs and web forms)
- TypeScript types derived from Zod schemas via `z.infer`
- Shared enums (`FlightType`, `OAuthProvider`, `PlanStatus`)
- API request/response contract interfaces

### 4.4 `packages/ui`

- React components built with Tailwind CSS
- Aviation-themed design tokens (colors, typography, spacing) — see Section 9 for branding requirements
- Compatible with both Next.js and Expo (web-only components initially; native variants added in mobile phase)
- Storybook integration is **recommended** but not required to ship MVP

---

## 5. Data Model

### 5.1 Prisma Schema

```prisma
model User {
  id              String           @id @default(cuid())
  email           String           @unique
  name            String
  avatarUrl       String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  deletedAt       DateTime?        // soft delete for LGPD

  oauthAccounts        OAuthAccount[]
  sessions             Session[]
  flightPlans          FlightPlan[]
  aircraftProfiles     AircraftProfile[]
  activityLogs         ActivityLog[]
  integrationConnections IntegrationConnection[]
}

model OAuthAccount {
  id                String    @id @default(cuid())
  provider          String    // "google"
  providerAccountId String
  accessToken       String?   // encrypted at rest (see Section 11)
  refreshToken      String?   // encrypted at rest (see Section 11)
  expiresAt         DateTime?
  createdAt         DateTime  @default(now())

  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id                String    @id @default(cuid())
  refreshTokenHash  String    @unique  // bcrypt hash of the raw refresh token (never stored raw)
  expiresAt         DateTime
  createdAt         DateTime  @default(now())
  lastUsedAt        DateTime  @default(now())
  userAgent         String?
  ipAddress         String?   // disclosed in privacy policy; LGPD compliant

  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model AircraftProfile {
  id              String    @id @default(cuid())
  name            String
  icaoType        String?   // e.g. "B738"
  cruiseSpeed     Int?      // knots
  fuelUnit        String?   // "kg" | "lbs" | "liters"
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  userId          String
  user            User      @relation(fields: [userId], references: [id])
  flightPlans     FlightPlan[]
}

model Airport {
  icao             String    @id
  iata             String?
  name             String
  city             String?
  country          String?
  latitude         Float
  longitude        Float
  elevation        Int?      // feet
  raw              Json?     // full source record (OurAirports) for future enrichment

  originPlans      FlightPlan[] @relation("origin")
  destinationPlans FlightPlan[] @relation("destination")
}

model FlightPlan {
  id                String       @id @default(cuid())
  status            PlanStatus   @default(DRAFT)
  flightType        FlightType   // VFR | IFR
  plannedAltitude   Int?         // feet
  remarks           String?
  simBriefOfpId     String?      // SimBrief OFP ID stored as reference after successful import
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
  deletedAt         DateTime?    // soft delete

  userId            String
  user              User         @relation(fields: [userId], references: [id])

  originIcao        String
  origin            Airport      @relation("origin", fields: [originIcao], references: [icao])

  destinationIcao   String
  destination       Airport      @relation("destination", fields: [destinationIcao], references: [icao])

  aircraftProfileId String?
  aircraftProfile   AircraftProfile? @relation(fields: [aircraftProfileId], references: [id])

  routes            FlightPlanRoute[]
}

model FlightPlanRoute {
  id              String     @id @default(cuid())
  sequence        Int
  waypointIdent   String
  latitude        Float?
  longitude       Float?
  airway          String?

  flightPlanId    String
  flightPlan      FlightPlan @relation(fields: [flightPlanId], references: [id], onDelete: Cascade)

  @@index([flightPlanId, sequence])
}

model IntegrationConnection {
  id          String    @id @default(cuid())
  service     String    // "simbrief"
  externalId  String?   // SimBrief pilot ID (username)
  metadata    Json?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  userId      String
  user        User      @relation(fields: [userId], references: [id])

  @@unique([userId, service])
}

model ActivityLog {
  id          String    @id @default(cuid())
  action      String    // e.g. "flight_plan.created", "auth.login", "simbrief.import"
  metadata    Json?     // no PII beyond userId
  createdAt   DateTime  @default(now())

  userId      String?
  user        User?     @relation(fields: [userId], references: [id])
}

enum PlanStatus {
  DRAFT
  SAVED
  ARCHIVED
}

enum FlightType {
  VFR
  IFR
}
```

### 5.2 LGPD Considerations

- `User.deletedAt` enables soft delete — physical deletion triggered on formal deletion request via `DELETE /v1/users/me`
- `Session.ipAddress` stored; must be explicitly disclosed in privacy policy
- `OAuthAccount.accessToken` and `.refreshToken` encrypted at rest (application-layer AES-256-GCM; key managed via env var)
- `ActivityLog` entries must not store PII beyond `userId`; `metadata` field is audited before writes
- Retention policy: sessions expire after 30 days; activity logs retained 12 months; expired records purged by scheduled job (Phase 5+)

---

## 6. API Endpoints

### Auth

| Method | Path                     | Description                                |
|--------|--------------------------|--------------------------------------------|
| GET    | /v1/auth/google          | Redirect to Google OAuth consent screen    |
| GET    | /v1/auth/google/callback | OAuth callback, issue tokens, set cookie   |
| POST   | /v1/auth/refresh         | Rotate access + refresh tokens             |
| POST   | /v1/auth/logout          | Revoke session (delete Session row from DB)|

### Users

| Method | Path           | Description                          |
|--------|----------------|--------------------------------------|
| GET    | /v1/users/me   | Get authenticated user profile       |
| PATCH  | /v1/users/me   | Update name, preferences             |
| DELETE | /v1/users/me   | Request account deletion (LGPD)      |

### Airports

| Method | Path               | Description                                      |
|--------|--------------------|--------------------------------------------------|
| GET    | /v1/airports       | Search by ICAO or name (`?q=SBGR`, max 20 results)|
| GET    | /v1/airports/:icao | Get single airport detail                        |

### Aircraft Profiles

| Method | Path                      | Description             |
|--------|---------------------------|-------------------------|
| GET    | /v1/aircraft-profiles     | List user's aircraft    |
| POST   | /v1/aircraft-profiles     | Create aircraft profile |
| PATCH  | /v1/aircraft-profiles/:id | Update                  |
| DELETE | /v1/aircraft-profiles/:id | Delete                  |

### Flight Plans

| Method | Path                           | Description                         |
|--------|--------------------------------|-------------------------------------|
| GET    | /v1/flight-plans               | List user's saved plans (paginated) |
| POST   | /v1/flight-plans               | Create new flight plan              |
| GET    | /v1/flight-plans/:id           | Get full plan with route            |
| PATCH  | /v1/flight-plans/:id           | Update plan                         |
| DELETE | /v1/flight-plans/:id           | Soft delete plan                    |
| POST   | /v1/flight-plans/:id/duplicate | Duplicate plan as new draft         |

### Integrations — SimBrief

| Method | Path                                        | Description                                                      |
|--------|---------------------------------------------|------------------------------------------------------------------|
| GET    | /v1/integrations/simbrief/ofp               | Fetch latest OFP for the authenticated user's pilot ID           |
| PATCH  | /v1/integrations/simbrief/connection        | Save or update user's SimBrief pilot ID                          |

> **Note on OFP generation:** endpoint `POST /v1/integrations/simbrief/generate` is **not included in MVP**. See Section 8 for rationale and open question status.

### Integrations — SkyVector

| Method | Path                           | Description                    |
|--------|--------------------------------|--------------------------------|
| GET    | /v1/integrations/skyvector/url | Build contextual SkyVector URL |

---

## 7. Airport Data Strategy

**Chosen approach: OurAirports static seed + Redis cache**

- **Source:** [OurAirports](https://ourairports.com/data/) — open dataset, CC0 license, ~74,000 airports worldwide, updated regularly by community
- **Load:** Prisma seed script downloads and imports the CSV at environment setup time; no runtime external dependency
- **Search:** PostgreSQL `pg_trgm` trigram index on `name` and `icao` columns; `ILIKE` fallback for exact ICAO lookups
- **Cache:** Redis caches search results keyed by normalized query string, TTL 1 hour
- **Future updates:** The seed script can be re-run against a refreshed CSV as a manual maintenance operation. Automated AIRAC cycle updates are out of MVP scope.
- **Legal:** OurAirports data is CC0 (public domain). No attribution required. Appropriate for commercial use.

> **Open question (see Section 17, item 2):** If Navigraph or AIRAC-cycle accuracy is required (e.g., for IFR waypoints and airways), the data source must change. OurAirports covers airports but not airways or fixes.

---

## 8. SimBrief Integration

SimBrief exposes a public JSON/XML API. Read operations require only the user's pilot ID (no API key).

### MVP scope: Import only

**Decision:** MVP implements **OFP import** (fetch latest OFP by pilot ID). OFP generation via API is deferred pending validation (see open question in Section 17, item 1).

**Rationale:** SimBrief's documented public endpoint supports fetching the latest dispatched OFP by pilot ID. OFP generation requires submitting parameters to a less-documented path whose availability and policy limits are not confirmed. Scoping MVP to import avoids building against an uncertain contract.

**Flow:**
1. User stores their SimBrief pilot ID via `PATCH /v1/integrations/simbrief/connection` → saved to `IntegrationConnection` (service = `"simbrief"`, externalId = pilot ID)
2. User triggers import from the flight plan UI → client calls `GET /v1/integrations/simbrief/ofp`
3. NestJS reads the authenticated user's `IntegrationConnection`, calls SimBrief API: `https://www.simbrief.com/api/xml.fetcher.php?username={pilotId}&json=1`
4. Response is parsed and normalized; relevant fields returned to client (origin, destination, route, fuel, OFP ID)
5. OFP payload is **not persisted** in the database; only the `simBriefOfpId` reference is written to `FlightPlan.simBriefOfpId` if the user saves the plan
6. Redis caches SimBrief API responses per pilot ID, TTL 5 minutes, to avoid hammering the external endpoint

**Error cases:**
- No `IntegrationConnection` for user → 400 with message prompting user to configure pilot ID
- SimBrief API unavailable or returns error → 502 with user-facing message; logged via Sentry

---

## 9. SkyVector Integration

SkyVector has no programmable API. Integration is read-only contextual URL construction.

**URL pattern:**
```
https://skyvector.com/?fpl=ORIGIN+WAYPOINT1+WAYPOINT2+DESTINATION
```

`GET /v1/integrations/skyvector/url` accepts query params `{ originIcao, destinationIcao, route? }` and returns a JSON object with `{ url: string }`. The web client opens it in a new tab.

> **QA note:** The URL deep-link format must be validated against current SkyVector behavior before Phase 4 cutover (see open question in Section 17, item 4).

---

## 10. Session and Refresh Token Policy

### Token types

| Token        | Format        | Lifespan | Storage (client)  | Storage (server)                                   |
|--------------|---------------|----------|-------------------|----------------------------------------------------|
| Access token | JWT (RS256)   | 15 min   | In-memory (JS var)| Not stored — stateless                             |
| Refresh token| JWT (RS256)   | 30 days  | `httpOnly` cookie | **bcrypt hash** of the raw JWT in `Session` table  |

### Refresh token structure

The refresh token is itself a **signed JWT** (RS256, same keypair as the access token) with the following claims:

```json
{
  "sub": "<userId>",
  "sid": "<sessionId>",
  "type": "refresh",
  "iat": ...,
  "exp": ...
}
```

The `sid` claim carries the `Session.id` primary key. This allows the server to locate the correct `Session` row **directly from the token itself**, with no dependency on the access token being present or valid.

### Storage rule

The raw refresh token (the full JWT string) is **never written to the database**. Only its bcrypt hash (`Session.refreshTokenHash`, cost factor 12) is persisted. On each use, the incoming raw token is compared against the stored hash via `bcrypt.compare`.

### Rotation

On `POST /v1/auth/refresh`:

1. Server reads raw refresh token from `httpOnly` cookie
2. Verifies JWT signature (RS256) and `"type": "refresh"` claim — rejects if signature is invalid or token is expired at JWT level
3. Extracts `sid` claim → queries `Session` table by `Session.id = sid`
4. If session not found or `Session.expiresAt` is past → reject (401), delete stale session row if found
5. Verifies `bcrypt.compare(rawToken, session.refreshTokenHash)` → rejects if mismatch (token reuse attack, see below)
6. Generates new access token + new refresh token (new JWT with same `sub`, new `sid` = new session ID)
7. Deletes old `Session` row; inserts new `Session` with `refreshTokenHash = bcrypt(newRawToken)`
8. Sets new `httpOnly` cookie with new refresh token; returns new access token in response body
9. New `Session.lastUsedAt` is set on creation; old row is gone

### Why this approach is correct

- The access token is **not required** during refresh — session lookup relies solely on `sid` inside the refresh token JWT
- The JWT signature prevents forged `sid` values without knowledge of the private key
- bcrypt comparison on top of signature verification provides defense-in-depth: even if an old token JWT were somehow presented after rotation, the hash would no longer match

### Invalidation

- **Logout:** `POST /v1/auth/logout` verifies the refresh token (steps 1–3 above), deletes the `Session` row, and clears the cookie. No access token required.
- **Expiry:** Both JWT `exp` and `Session.expiresAt` are checked independently. Either can reject the request.
- **Multi-device:** Each device/login produces a distinct `Session` row with a distinct `sid`. Logout from one device does not affect others (out of MVP scope to add "logout all sessions").
- **Token reuse detection:** If `bcrypt.compare` fails on a session that exists (step 5), it means a previously rotated token was replayed. All `Session` rows for that `userId` are deleted immediately, forcing full re-login. Redis is not required for this — the DB row mismatch is the signal.

---

## 11. Security

- All secrets (DB URL, Redis URL, Google OAuth credentials, JWT private key, AES encryption key) via environment variables; never committed
- JWT access tokens signed with **RS256** (asymmetric keypair); only the API holds the private key
- Refresh tokens stored as **bcrypt hash** in `Session` table (cost factor 12)
- `OAuthAccount.accessToken` and `.refreshToken` encrypted with **AES-256-GCM** at application layer before writes
- `httpOnly; Secure; SameSite=Strict` cookie for refresh token
- Rate limiting on auth endpoints: 10 requests/min per IP (NestJS ThrottlerModule + Redis store)
- CORS: only configured origins (web domain) allowed
- Input validation via Zod on all API endpoints (class-validator + class-transformer in NestJS DTOs)
- Helmet middleware for HTTP security headers (HSTS, CSP, X-Frame-Options)

---

## 12. Branding and Design System Requirements

The functional spec requires the product to reflect the Simulando channel visual identity with an aviation/cockpit aesthetic. This section translates that into technical requirements.

### Required before MVP dashboard is considered done

1. **Design tokens defined** in `packages/ui/src/tokens.ts`:
   - `colors`: primary, accent, surface, background, text, error, success — with aviation-appropriate palette (dark backgrounds, high-contrast HUD-style accent colors)
   - `typography`: font families, scale (heading, body, caption, mono for data values)
   - `spacing`: 4px base grid
   - `radius`: card and button radius values

2. **Tailwind config** in `packages/config/tailwind.config.js` must consume these tokens so all apps share the same values

3. **Minimum component set** required for MVP dashboard:
   - `Button` (primary, secondary, ghost)
   - `Card` (module card, flight summary card)
   - `Badge` (status, flight type)
   - `Input`, `Select`, `Combobox` (for airport search)
   - `Avatar` (user header)
   - `Spinner` / `Skeleton` (loading states)

4. **Asset dependency:** Simulando logo (SVG) and any official brand color values must be provided by the product/channel team before the design system tokens can be finalized. Implementation of the dashboard UI is **blocked** on receipt of branding assets.

### Definition of done for dashboard visual identity

- [ ] Branding assets received from Simulando channel team
- [ ] Design tokens set in `packages/ui` using official palette
- [ ] Dashboard does not use default Tailwind blue or generic SaaS gray schemes
- [ ] At least one aviation-context visual element present (e.g., ICAO identifier display style, altitude/route data in monospaced instrument-style font)

### Dark mode

Dark mode is noted in the spec as a future option, not a current requirement. MVP ships with a single theme. The token structure must support theming (CSS custom properties), but dark mode values are not required at MVP.

---

## 13. Caching Strategy

| Data                        | TTL      | Store  | Notes                                                  |
|-----------------------------|----------|--------|--------------------------------------------------------|
| Airport search results      | 1 hour   | Redis  | Keyed by lowercase normalized query string             |
| SimBrief OFP response       | 5 min    | Redis  | Keyed by pilot ID                                      |
| Rotated refresh token reuse | —        | DB only| Reuse detected via bcrypt mismatch on existing Session row; no Redis blacklist needed |
| Rate limit windows          | 1 min    | Redis  | Per IP, sliding window via ThrottlerModule             |
| User session validity       | —        | DB only| Sessions validated against DB on each refresh request  |

---

## 14. Observability

**Required for MVP:**
- **Sentry:** installed in `apps/api` (Node.js SDK) and `apps/web` (Next.js SDK) from first deploy — per functional spec non-functional requirement
- **Structured logging:** NestJS uses `pino` logger with JSON output; log level configurable via `LOG_LEVEL` env var
- **ActivityLog:** DB writes for domain events (`auth.login`, `auth.logout`, `flight_plan.created`, `flight_plan.duplicated`, `simbrief.import`)
- **Health check:** `GET /v1/health` returns DB + Redis connectivity status

**Recommended (post-MVP):**
- **Posthog** (or compatible LGPD-compliant tool): client-side product analytics; requires opt-out mechanism before enabling; not a blocker for MVP launch

---

## 15. Infrastructure & Deployment

MVP target: single-region deployment.

| Component    | Service                        | Notes                                           |
|--------------|--------------------------------|-------------------------------------------------|
| API          | Railway / Render               | Docker container, auto-deploy from `main` branch|
| Web          | Vercel                         | Next.js native platform                         |
| Database     | Railway Postgres / Supabase DB | Managed Postgres 16                             |
| Redis        | Railway Redis / Upstash        | Managed Redis 7                                 |
| File storage | Not required in MVP            | —                                               |
| CI/CD        | GitHub Actions                 | lint → typecheck → test → build → deploy        |

**Local dev:** Docker Compose spins up Postgres + Redis. `apps/api` and `apps/web` run natively via `turbo dev`.

---

## 16. Development Environment Setup

```bash
# Prerequisites: Node 20 LTS, pnpm 9, Docker

# 1. Install dependencies
pnpm install

# 2. Start infrastructure
docker compose up -d

# 3. Copy env files
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# 4. Run DB migrations and seed airports
pnpm --filter api prisma migrate dev
pnpm --filter api prisma db seed

# 5. Start all services
pnpm dev
```

---

## 17. Package Manager

**pnpm** (v9) — chosen over npm workspaces for:
- Efficient disk usage via content-addressable store
- Strict phantom dependency prevention
- First-class Turborepo compatibility

---

## 18. MVP Delivery Phases

### Phase 0 — Foundation
- [ ] Turborepo monorepo scaffold
- [ ] `packages/config`: shared TypeScript, ESLint, Tailwind configs
- [ ] `packages/types`: base Zod schemas and enums
- [ ] Docker Compose for local infra
- [ ] CI pipeline (lint + typecheck + build)

### Phase 1 — Auth
- [ ] NestJS `auth` module: Google OAuth, JWT (RS256), session management
- [ ] Refresh token rotation with reuse detection (DB-based bcrypt mismatch, no Redis required)
- [ ] `User`, `OAuthAccount`, `Session` Prisma models + migrations
- [ ] Next.js login page and auth middleware
- [ ] `/v1/users/me` endpoint

### Phase 2 — Dashboard
- [ ] Design tokens + minimum component set in `packages/ui` (blocked on branding assets)
- [ ] Authenticated dashboard layout in Next.js
- [ ] Module cards (Flight Planning highlighted, others as placeholders)
- [ ] Recent flight plans widget (empty state for now)

### Phase 3 — Flight Planning Core
- [ ] OurAirports seed script + search endpoint with `pg_trgm`
- [ ] `AircraftProfile` CRUD
- [ ] `FlightPlan` + `FlightPlanRoute` CRUD
- [ ] Multi-step flight plan form on web
- [ ] Flight plan history list + reopen + duplicate

### Phase 4 — Integrations
- [ ] SimBrief pilot ID connection save/update
- [ ] SimBrief OFP import adapter (fetch + normalize)
- [ ] SkyVector URL builder (pending QA validation of deep-link format)
- [ ] Integration UI on flight plan form

### Phase 5 — Observability & Hardening
- [ ] Sentry integration (web + api)
- [ ] ActivityLog writes on all key domain events
- [ ] Rate limiting on auth and integration endpoints
- [ ] e2e tests (Playwright) for auth flow and flight plan creation
- [ ] `GET /v1/health` endpoint

---

## 19. Business Analyst Resolution Log (2026-03-22)

1. **SimBrief generation vs import:** MVP remains **import-only** (fetch latest OFP by pilot ID). OFP generation stays out of initial delivery.

2. **Airport data source:** OurAirports (CC0) remains the approved MVP seed source for airport metadata. AIRAC-level enrichment is deferred.

3. **Aircraft profiles and references:** Beyond user-defined profiles, aircraft references should support SimBrief aircraft and other publicly available aircraft documentation. AI-assisted aggregation is acceptable when reviewed by humans before shipping.

4. **SkyVector deep-link format:** Validation of the `?fpl=` pattern remains mandatory as a QA checkpoint before Phase 4 cutover. This is not a blocker for Phase 0.

5. **Branding source:** Until expanded brand assets are delivered, product UI should use Simulando channel branding as baseline (`https://www.youtube.com/@SimulandoMSFS`).

6. **i18n framework at scaffold time:** `next-intl` is approved for Phase 0 with both Portuguese (`pt-BR`) and English (`en`) implemented from the start.
