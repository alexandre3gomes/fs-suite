# FS Suite — Technical Specification

> **Status:** v0.5 — Cleared for implementation (approved by Analista de negocio, 2026-03-23)
> **Version:** 0.5
> **Derived from:** `docs/project-spec.md`
> **Changelog:** v0.5 — Frontend stack revision approved in principle by BA (Entry 004, 2026-03-23): replace `apps/web` (Next.js) + `apps/mobile` (Expo scaffold) with a single `apps/app` (Expo Router SDK 51+ targeting iOS, Android, and Web from one codebase). NestJS API, Prisma schema, packages/types, and Docker/CI infrastructure unchanged. packages/ui rewritten to React Native primitives + NativeWind. i18n library replaced: `next-intl` → `expo-localization + i18next` (same locales: pt-BR + en). SSR/SSG trade-off formally registered in §20. packages/ui migration plan added to §12. Phase 0 re-execution scope defined in §18. v0.4 — Section 19 BA decisions resolved: SimBrief import-only confirmed, aircraft source policy updated, SkyVector validation classified as pre-Phase-4 QA gate, branding source set to Simulando channel, and `next-intl` confirmed with `pt-BR` + `en`. v0.3 — fixed refresh token session lookup: refresh token is now a signed JWT containing sessionId, removing dependency on access token during rotation. v0.2 — addressed BA review feedback: SimBrief scope, refresh token policy, endpoint contract, branding requirements, optional infra classification, airport data sourcing
> **Language:** English (code and technical docs); Portuguese pt-BR (user-facing content)

---

## 1. Overview

This document translates the functional requirements from the FS Suite product specification into concrete technical decisions, architecture definitions, data models, API contracts, and infrastructure choices.

Functional requirements are owned by the product/business team and **must not be modified here**. This spec exists to serve those requirements and must be revised whenever functional requirements change.

---

## 2. Monorepo Structure

> **v0.5 change:** `apps/web` and `apps/mobile` are replaced by a single `apps/app` (Expo Router). See §20 for rationale and trade-offs.

```
fs-suite/
├── apps/
│   ├── app/                   # Expo Router SDK 51+ — iOS, Android, and Web from one codebase
│   └── api/                   # NestJS 10
├── packages/
│   ├── ui/                    # Shared component library (React Native + NativeWind)
│   ├── types/                 # Shared TypeScript types and Zod schemas
│   └── config/                # Shared ESLint, TypeScript, and Prettier configs
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
| App framework        | Expo Router                   | SDK 51+   | Yes          | Single codebase for iOS, Android, and Web; file-based routing; replaces Next.js + Expo separately |
| API framework        | NestJS                        | 10.x      | Yes          | Modular, decorator-based, DI container, good for domain isolation |
| Language             | TypeScript                    | 5.x       | Yes          | Strict mode across all packages                                   |
| ORM                  | Prisma                        | 5.x       | Yes          | Type-safe queries, migration management, good Postgres support    |
| Database             | PostgreSQL                    | 16        | Yes          | Relational, JSONB support for flexible route data                 |
| Cache                | Redis                         | 7.x       | Yes          | Rate limiting, short-TTL airport data cache, refresh token rotation|
| Auth                 | Passport.js (NestJS)          | —         | Yes          | Google OAuth 2.0 strategy; JWT for stateless API tokens           |
| Monorepo             | Turborepo                     | 2.x       | Yes          | Task caching, pipeline orchestration                              |
| Component styling    | NativeWind                    | 4.x       | Yes          | Tailwind CSS utility classes for React Native; works on web and native |
| Schema validation    | Zod                           | 3.x       | Yes          | Shared between `packages/types`, API DTOs, and app form schemas   |
| i18n                 | expo-localization + i18next   | —         | Yes          | Device locale detection (Expo) + translation management (i18next); replaces `next-intl` which is Next.js-only. Locales: `pt-BR` (default) + `en` |
| Testing (unit)       | Vitest                        | 1.x       | Yes          | Fast, ESM-native, compatible with Expo and NestJS                 |
| Testing (e2e)        | Playwright                    | 1.x       | Yes          | Browser-level e2e for web target; Detox considered for native (post-MVP) |
| Error tracking       | Sentry                        | —         | Yes          | React Native + Node.js SDK; required from first deploy per spec   |
| Event logging        | Posthog (self-hosted optional)| —         | Recommended  | Product analytics; LGPD opt-out required. Not a blocker for MVP launch |
| Component docs       | Storybook                     | —         | Recommended  | Useful once design system matures; not required to ship MVP       |
| Container            | Docker + Docker Compose       | —         | Yes (local)  | Local dev environment (Postgres, Redis)                           |

> **Note on "Recommended" items:** Posthog and Storybook are proposed as infrastructure improvements, not functional requirements. They can be added post-MVP-launch without affecting user-facing features.

> **v0.5 i18n substitution:** `next-intl` was approved in Decision 003 / Section 19 item 6. That decision is superseded by this revision. `next-intl` is a Next.js-specific library and does not run in React Native. `expo-localization + i18next` provides equivalent functionality (locale detection, translation keys, pluralization) and is the standard cross-platform solution for Expo projects. The approved locales (`pt-BR` default + `en`) are unchanged.

---

## 4. Application Architecture

### 4.1 `apps/api` — NestJS

Modules:

```
src/
├── auth/           # Google OAuth, JWT issue/refresh, session management
├── users/          # User profile CRUD, preferences, admin user management
├── airports/       # Airport lookup by ICAO/name, data caching
├── flight-plans/   # FlightPlan CRUD, duplication, history
├── integrations/
│   ├── simbrief/   # SimBrief OFP import adapter (generation pending validation — see Section 8)
│   └── skyvector/  # SkyVector contextual URL builder
├── email/          # One-click unsubscribe token + public unsubscribe endpoint
├── feedback/       # User bug reports / suggestions: submit + attachments, admin triage, Resend reply
├── activity/       # ActivityLog writes
└── common/         # Guards, interceptors, filters, decorators
```

**Authentication flow** (see `docs/adr-001-auth-code-exchange.md`):
1. Web client redirects to `/auth/google` (NestJS Passport redirect)
2. Google callback hits `/auth/google/callback`
3. NestJS creates or updates `User` + `OAuthAccount` records
4. Creates a `Session` row; issues a short-lived JWT access token (15 min) and a refresh token JWT (30 days) containing the `sessionId` as the `sid` claim — only the bcrypt hash of the raw refresh token is stored in `Session.refreshTokenHash` (see Section 10 for full token policy)
5. Tokens are stored in Redis under a one-time auth code (TTL 60s). The redirect URL carries only `?code=XXXXX` — no tokens in the URL (security: prevents token exposure in browser history, logs, and referrer headers)
6. Client calls `POST /auth/exchange` with the code → receives access token in JSON body; refresh token set as `httpOnly; Secure; SameSite=Strict` cookie (web) or returned in body (native)
7. `/auth/refresh` rotates both tokens using `sid` from the refresh token to locate the session — no access token required (see Section 10)

**Client-side 401 handling:**
The API client (`apps/app/src/services/api.client.ts`) intercepts 401 responses, attempts a single token refresh via `POST /auth/refresh`, and retries the original request. A mutex prevents concurrent refresh races. If refresh fails, the session is cleared and the user is redirected to login.

**API contract style:** REST, JSON. Versioned under `/v1/`. OpenAPI spec auto-generated via `@nestjs/swagger`.

### 4.2 `apps/app` — Expo Router

> **v0.5 change:** replaces `apps/web` (Next.js) and `apps/mobile` (Expo scaffold). Single codebase runs on iOS, Android, and Web.

Route structure (Expo Router file-based, mirrors the previous Next.js App Router layout):

```
app/
├── (public)/
│   └── login/          # Google OAuth entry point
├── (auth)/
│   ├── _layout.tsx      # Auth shell with navigation
│   ├── dashboard/       # Authenticated home
│   ├── flight-plans/
│   │   ├── new/         # New flight plan form
│   │   ├── [id]/        # View/edit saved plan
│   │   └── index.tsx    # History list
│   └── profile/         # User profile and preferences
└── _layout.tsx          # Root layout (fonts, theme, providers)
```

**Rendering target:**
- **Web:** Expo Router renders via `react-native-web` as real HTML elements (`div`, `span`, `input`) — not canvas. Native browser behaviors (scroll, text selection, copy-paste, deep links, accessibility) are preserved.
- **Native (iOS/Android):** Standard React Native rendering via Hermes.

**State management:** Zustand for client-side UI state (form steps, modal state, auth token in memory). No Redux. Server-side data fetching via React Query (replaces SWR — better React Native support).

**Data fetching:** All data fetching via NestJS API REST calls. React Query manages caching and revalidation across both web and native targets.

**Auth on web:** JWT stored in memory (access token); refresh token in `httpOnly` cookie managed by NestJS. Expo Router middleware (via `expo-router/server`) validates session on protected routes.

**Auth on native:** JWT access token stored in memory; refresh token stored in `expo-secure-store` (iOS Keychain / Android Keystore). Token refresh logic shared via a common auth service module.

**Responsive layout:** Expo Router on web supports CSS media queries via NativeWind. Components use responsive breakpoint utilities (`sm:`, `md:`, `lg:`) to adapt layout for desktop (≥1024px), tablet (≥768px), and mobile (<768px). Dashboard layout validated on all three breakpoints before Phase 2 is considered done.

### 4.3 `packages/types`

Single source of truth for:
- Zod schemas (validated at runtime in API DTOs and web forms)
- TypeScript types derived from Zod schemas via `z.infer`
- Shared enums (`FlightType`, `OAuthProvider`, `PlanStatus`)
- API request/response contract interfaces

### 4.4 `packages/ui`

> **v0.5 change:** Components migrated from React DOM primitives to React Native primitives. `react-native-web` renders them as HTML on web — no separate web/native variants required for MVP components.

- Components built with **React Native primitives** (`View`, `Text`, `TextInput`, `Pressable`, `ScrollView`) + **NativeWind** for styling
- Aviation-themed design tokens (colors, typography, spacing) — see Section 9 and Section 12 for branding requirements
- Works on iOS, Android, and Web from the same component source — no `.native.tsx` / `.web.tsx` splits for MVP components
- `tokens.ts` preserved; values consumed via NativeWind theme config instead of Tailwind web config
- Storybook integration is **recommended** but not required to ship MVP
- See Section 12 for migration plan from the Phase 0 React DOM scaffold

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
  isAdmin         Boolean          @default(false)
  marketingEmailConsent          Boolean   @default(true)
  marketingEmailConsentUpdatedAt DateTime?

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
  flightRules       FlightRules  // VFR | IFR | VFR_IFR | IFR_VFR
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
  COMPLETED
  ARCHIVED
}

enum FlightRules {
  VFR
  IFR
  VFR_IFR
  IFR_VFR
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

| Method | Path                     | Description                                             |
|--------|--------------------------|---------------------------------------------------------|
| GET    | /v1/auth/google          | Redirect to Google OAuth consent screen                 |
| GET    | /v1/auth/google/callback | OAuth callback, store auth code in Redis, redirect      |
| POST   | /v1/auth/exchange        | Exchange one-time auth code for tokens (see ADR-001)    |
| POST   | /v1/auth/refresh         | Rotate access + refresh tokens                          |
| POST   | /v1/auth/logout          | Revoke session (delete Session row from DB)             |

### Users

| Method | Path           | Description                                                  |
|--------|----------------|--------------------------------------------------------------|
| GET    | /v1/users/me   | Get authenticated user profile (response includes effective `isAdmin`) |
| PATCH  | /v1/users/me   | Update name or `marketingEmailConsent`                       |
| DELETE | /v1/users/me   | Request account deletion (LGPD)                              |

Admin access is the persisted `User.isAdmin` flag (toggled from the in-app
admin area), with the `ADMIN_EMAILS` allow-list (`auth/admin-emails.ts`) as a
bootstrap fallback so the instance can never be locked out. The effective
status is computed by `isUserAdmin()` and enforced by `AdminGuard`.

### Admin — User management

Gated by `JwtAuthGuard` + `AdminGuard`. This is the in-app **user management**
area (the earlier announcement/broadcast feature was removed).

| Method | Path                | Description                                   |
|--------|---------------------|-----------------------------------------------|
| GET    | /v1/admin/users     | List all users with effective admin status    |
| PATCH  | /v1/admin/users/:id | Grant or revoke admin access (`{ isAdmin }`)  |
| DELETE | /v1/admin/users/:id | Soft-delete a user (LGPD-consistent)          |

### Feedback

See `docs/feedback-feature-spec.md` for the full design. User endpoint is
`JwtAuthGuard`; admin endpoints add `AdminGuard`. Attachments (≤3 files, ≤5 MB,
`png/jpeg/webp/pdf`) are validated by magic bytes, images re-encoded via `sharp`,
stored privately in R2 under a `feedback/` prefix, and streamed back only through
the admin-gated endpoint with `Content-Disposition: attachment`.

| Method | Path                                          | Description                                                        |
|--------|-----------------------------------------------|--------------------------------------------------------------------|
| POST   | /v1/feedback                                  | Submit a bug/suggestion (`multipart/form-data`: `type`, `description`, `files[]`); emails admins via Resend |
| GET    | /v1/admin/feedback?status=&type=              | List feedback, newest first, optional filters                      |
| GET    | /v1/admin/feedback/:id                        | Feedback detail with attachments + reply                           |
| POST   | /v1/admin/feedback/:id/reply                  | Persist reply, set `ANSWERED`, email the reporter via Resend       |
| PATCH  | /v1/admin/feedback/:id/status                 | Update status (`OPEN`/`ANSWERED`/`RESOLVED`); no email             |
| GET    | /v1/admin/feedback/:id/attachments/:attId     | Stream an attachment (admin only)                                  |

**Email flow:** feedback emails are operational/transactional (no
`marketingEmailConsent` gate, no unsubscribe link), built and handed to the
central `MailerService` (`email` module). In **production** it sends via the
Resend SDK from `FEEDBACK_EMAIL_FROM` (default `FS Suite <feedback@fs-suite.com>`);
**outside production** it captures the email into a dev inbox at `GET /v1/dev/emails`
(dev-only) instead of sending — set `MAIL_FORCE_SEND=true` to send for real from
a non-prod env. Admin recipients use the shared `getAdminRecipients()` helper
(`User.isAdmin ∪ ADMIN_EMAILS`) — the same source the metrics digest uses.

**Attachment lifecycle:** `RetentionService.purgeResolvedFeedbackAttachments()`
drops R2 objects + attachment rows for feedback `RESOLVED` more than 90 days ago
(the feedback row is kept for audit).

### Email

Public, HMAC-token-authenticated. The `email` module exposes **only** the LGPD
one-click unsubscribe; there is no active email sending today (Resend stays
configured and reserved for future user communications).

| Method | Path                                   | Description                                                            |
|--------|----------------------------------------|------------------------------------------------------------------------|
| GET    | /v1/email/unsubscribe?u=&lt;id&gt;&t=&lt;hmac&gt; | One-click unsubscribe — sets `marketingEmailConsent=false`; renders an HTML page |

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

## 12. Branding, Design System, and packages/ui Migration

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

Dark mode is noted in the spec as a future option, not a current requirement. MVP ships with a single theme. The token structure must support theming (NativeWind dark mode via `colorScheme`), but dark mode values are not required at MVP.

### packages/ui Migration Plan (Phase 0 re-execution)

The Phase 0 scaffold delivered 5 components using React DOM primitives (`div`, `span`, `className`). These must be rewritten before Phase 1 begins.

| Component | Migration effort | Notes |
|---|---|---|
| `Button` | Low | `div` → `Pressable`, `className` → NativeWind `className` (NativeWind v4 supports JSX className) |
| `Card` | Low | `div` → `View`, style props preserved via NativeWind |
| `Badge` | Low | `span` → `View` + `Text`, variant logic unchanged |
| `Input` | Medium | `input` → `TextInput`; label/error layout needs `View` wrapper |
| `Spinner` | Low | Replace CSS animation with `Animated` API or `react-native-reanimated` |

**New components required for MVP (built natively from the start):**
- `Select` — use `@react-native-picker/picker` with NativeWind styling
- `Combobox` — airport search: `TextInput` + `FlatList` dropdown; custom implementation
- `Avatar` — `Image` + `View` fallback with initials
- `Skeleton` — `react-native-reanimated` shimmer animation

**Acceptance criteria for packages/ui re-execution:**
- All 5 existing components render correctly on iOS simulator, Android emulator, and Chrome (web)
- NativeWind v4 configured and Tailwind tokens from `tokens.ts` consumed via theme extension
- No `div`, `span`, or `className` (string-based) remaining in component source (NativeWind `className` prop is acceptable — it is the NativeWind API, not raw HTML)
- TypeScript types unchanged — consumers of `packages/ui` require no import changes

**Estimated effort:** 2–3 days for the 5 existing components + NativeWind setup. New components (Select, Combobox, Avatar, Skeleton) are built during Phase 2 (Dashboard).

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
- **Sentry:** installed in `apps/api` (Node.js SDK) and `apps/app` (React Native + web SDK via `@sentry/react-native`) from first deploy — per functional spec non-functional requirement
- **Structured logging:** NestJS uses `pino` logger with JSON output; log level configurable via `LOG_LEVEL` env var
- **ActivityLog:** DB writes for domain events (`auth.login`, `auth.logout`, `flight_plan.created`, `flight_plan.duplicated`, `simbrief.import`)
- **Health check:** `GET /v1/health` returns DB + Redis connectivity status

**Recommended (post-MVP):**
- **Posthog** (or compatible LGPD-compliant tool): client-side product analytics; requires opt-out mechanism before enabling; not a blocker for MVP launch

---

## 15. Infrastructure & Deployment

Single-region production deployment (EU-West).

| Component    | Service                                         | Notes                                                                                   |
|--------------|-------------------------------------------------|-----------------------------------------------------------------------------------------|
| API          | EC2 t3.small                                    | `eu-west-1` serves prod (sole API runtime; the Cloud Run candidate was decommissioned 2026-06) |
| Web (app)    | Cloudflare Pages                                | Expo web export, automatic deploys via `deploy-app.yml`                                 |
| iOS          | Expo EAS Build + App Store *(post-MVP)*         | OTA via EAS Update; not in current pipeline                                             |
| Android      | Expo EAS Build + Play Store *(post-MVP)*        | OTA via EAS Update; not in current pipeline                                             |
| Database     | Supabase Postgres 16                            | Connected via Supavisor session-mode pooler (IPv4); `eu-central-1`                      |
| Redis        | Upstash Redis 7                                 | Serverless, TLS (`rediss://`)                                                           |
| File storage | Cloudflare R2                                   | Aerodrome chart overlay cache; bucket `fs-suite-charts`                                 |
| DNS / TLS    | Cloudflare                                      | Proxied, Full (Strict) mode; Origin Certificate terminates TLS at EC2 nginx             |
| Observability| Sentry + PostHog                                | Sentry for backend + frontend errors (shared DSN); PostHog for client product analytics |
| CI/CD        | GitHub Actions                                  | `ci.yml`, `deploy.yml`, `deploy-app.yml`, `db-backup.yml`, `metrics-digest.yml`         |

See `infra/README.md` for the operational runbook (provisioning, secrets, deploy pipeline, failover, recovery).

**Local dev:** Docker Compose spins up Postgres + Redis. `apps/app` runs via `npx expo start --web` (web) or Expo Go / simulator (native). `apps/api` runs via NestJS dev server. Both orchestrated via `turbo dev`.

---

## 16. Development Environment Setup

```bash
# Prerequisites: Node 20 LTS, pnpm 9, Docker, Expo CLI (npm i -g expo-cli)

# 1. Install dependencies
pnpm install

# 2. Start infrastructure
docker compose up -d

# 3. Copy env files
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/app/.env.example apps/app/.env

# 4. Run DB migrations and seed airports
pnpm --filter api prisma migrate dev
pnpm --filter api prisma db seed

# 5. Start all services
pnpm dev
# apps/app: Expo dev server (web at localhost:8081, native via Expo Go)
# apps/api: NestJS at localhost:3001
```

---

## 17. Package Manager

**pnpm** (v9) — chosen over npm workspaces for:
- Efficient disk usage via content-addressable store
- Strict phantom dependency prevention
- First-class Turborepo compatibility

---

## 18. MVP Delivery Phases

> **Phase numbering note:** The technical delivery phases in this section do not map 1:1 to the product roadmap phases in `docs/project-spec.md §13`. The product spec groups Auth + Dashboard + Foundation into a single "Fase 0", then names flight planning "Fase 1". This document decomposes that scope into finer-grained technical phases (0 through 5) to allow incremental delivery, independent validation, and clearer acceptance criteria per phase. The table below records the explicit mapping so handoffs between product, architecture, and development remain unambiguous.
>
> | Technical phase | Product spec phase |
> |-----------------|--------------------|
> | Phase 0 — Foundation scaffold | Fase 0 (infrastructure portion) |
> | Phase 1 — Auth | Fase 0 (auth + session portion) |
> | Phase 2 — Dashboard | Fase 0 (dashboard + identity portion) |
> | Phase 3 — Flight Planning Core | Fase 1 — Planejamento de voo |
> | Phase 4 — Integrations | Fase 1 (SimBrief + SkyVector portion) |
> | Phase 5 — Observability & Hardening | cross-cutting (all product phases) |

> **v0.5 note:** Phase 0 requires partial re-execution due to the frontend stack change. The NestJS API, Prisma schema, Docker Compose, and CI pipeline delivered in the original Phase 0 are reused unchanged. Only `apps/web`, `apps/mobile`, and `packages/ui` are replaced.

### Phase 0 — Foundation (re-execution scope)

**Reused from original Phase 0 (no changes needed):**
- `apps/api` — NestJS scaffold, Prisma schema, `nest-cli.json`
- Docker Compose — PostgreSQL 16 + Redis 7
- CI pipeline — GitHub Actions (lint → typecheck → build → test)
- `packages/types` — Zod schemas and enums
- `packages/config` — TypeScript strict, ESLint, Prettier configs
- `.env.example` files (root + api)

**New / replaced items:**
- [ ] Remove `apps/web` and `apps/mobile`; scaffold `apps/app` with Expo Router SDK 51+
- [ ] Configure Expo Router for web + native targets (metro, babel, app.json)
- [ ] Configure NativeWind v4 in `apps/app`
- [ ] Rewrite `packages/ui` components (Button, Card, Badge, Input, Spinner) to React Native primitives + NativeWind — see §12 migration plan
- [ ] Configure `expo-localization + i18next` in `apps/app` with `pt-BR` (default) and `en`
- [ ] Scaffold route structure: `(public)/login`, `(auth)/dashboard`, `(auth)/flight-plans`, `(auth)/profile`
- [ ] Update `packages/config/tailwind` to NativeWind theme config consuming `tokens.ts`
- [ ] Update `turbo.json` globalEnv: remove `NEXTAUTH_URL`, `NEXTAUTH_SECRET`; add `EXPO_PUBLIC_API_URL`
- [ ] Update `.env.example` for `apps/app`
- [ ] Verify typecheck passing on all packages and `apps/app`

**Estimated effort:** 3–5 days.

### Phase 1 — Auth
- [ ] NestJS `auth` module: Google OAuth, JWT (RS256), session management
- [ ] Refresh token rotation with reuse detection (DB-based bcrypt mismatch, no Redis required)
- [ ] `User`, `OAuthAccount`, `Session` Prisma models + migrations
- [ ] Login screen in `apps/app` (web: OAuth redirect; native: in-app browser via `expo-web-browser`)
- [ ] Route protection middleware in Expo Router (`(auth)` group guard)
- [ ] Access token stored in memory; refresh token in `httpOnly` cookie (web) / `expo-secure-store` (native)
- [ ] `/v1/users/me` endpoint

### Phase 2 — Dashboard
- [ ] Design tokens + complete component set in `packages/ui` (Select, Combobox, Avatar, Skeleton) — blocked on branding assets
- [ ] Authenticated dashboard layout in `apps/app` — validated on desktop ≥1024px, tablet ≥768px, mobile native
- [ ] Module cards (Flight Planning highlighted, others as placeholders)
- [ ] Recent flight plans widget (empty state for now)

### Phase 3 — Flight Planning Core
- [ ] OurAirports seed script + search endpoint with `pg_trgm`
- [ ] `AircraftProfile` CRUD
- [ ] `FlightPlan` + `FlightPlanRoute` CRUD
- [ ] Multi-step flight plan form in `apps/app`
- [ ] Flight plan history list + reopen + duplicate

### Phase 4 — Integrations
- [ ] SimBrief pilot ID connection save/update
- [ ] SimBrief OFP import adapter (fetch + normalize)
- [ ] SkyVector URL builder (pending QA validation of deep-link format; opens in `expo-web-browser` on native)
- [ ] Integration UI on flight plan form

### Phase 5 — Observability & Hardening
- [ ] Sentry integration (`apps/app` React Native SDK + `apps/api` Node.js SDK)
- [ ] ActivityLog writes on all key domain events
- [ ] Rate limiting on auth and integration endpoints
- [ ] e2e tests (Playwright) for web target; Detox setup considered for native (post-MVP)
- [ ] `GET /v1/health` endpoint

---

## 19. Formal Trade-off Register (v0.5)

This section documents the formally accepted trade-offs introduced by the v0.5 stack revision. Each trade-off was evaluated against the MVP functional requirements and is considered acceptable for the product scope.

### Trade-off 1 — No SSR/SSG on the web target

**What is lost:** Expo Router Web does not provide mature server-side rendering or static site generation. Pages are rendered client-side (SPA model) on the web target.

**Why it is acceptable:** The product is a dashboard for authenticated users. There are no public content pages requiring SEO or pre-rendering. The login page is the only public-facing route and works correctly as a client-rendered SPA. If a fully public landing page is required in a future phase, it can be served as a separate lightweight static page (outside `apps/app`) without affecting the core product.

**Condition for revisiting:** If the product introduces SEO-dependent public pages (e.g., marketing landing, public route sharing), this trade-off must be re-evaluated and may require a separate Next.js or Astro static site.

---

### Trade-off 2 — NativeWind CSS coverage vs. full Tailwind

**What is lost:** Some Tailwind CSS features that rely on browser pseudo-selectors or complex cascading (`:hover` with state variants, arbitrary CSS properties) are not available in NativeWind's React Native target. They are available on the web target only.

**Why it is acceptable:** The aviation/cockpit design aesthetic targets visual hierarchy, spacing, and color — all fully supported by NativeWind. Hover states on native use `Pressable`'s `pressed` state instead of CSS `:hover`. The design system in `packages/ui` must be authored with NativeWind's cross-platform constraints as a first-class concern.

---

### Trade-off 3 — React Native Web rendering differences

**What is delivered:** `react-native-web` renders React Native primitives as real HTML elements on web (`View` → `div`, `Text` → `span`, `TextInput` → `input`). Browser native behaviors (text selection, scroll, deep links, accessibility tree) are preserved.

**Known limitation:** Some browser-specific CSS behaviors (e.g., `position: sticky`, complex `grid` layouts) require wrapping with `react-native-web`'s `StyleSheet` or platform-specific files (`.web.tsx`). MVP components are designed to avoid these edge cases. If they arise, platform-specific variants will be introduced per component, documented in `packages/ui`.

---

### Note on `docs/project-spec.md` alignment

`docs/project-spec.md` currently names `apps/web` (Next.js) and `apps/mobile` (Expo React Native) explicitly in sections §10 and §17. This document is owned by the product/business team and cannot be modified by the Arquiteto.

The Business Analyst must either:
- Update `docs/project-spec.md` §10 and §17 to reflect the single `apps/app` (Expo Router) decision, or
- Append an addendum to `docs/project-spec.md` with a dated note superseding the stack recommendation in those sections.

Suggested addendum text for BA use:

> **Addendum (2026-03-23):** Stack recommendation in §10 and §17 superseded by product decision to maintain a single frontend codebase for web and mobile, with near-term native mobile delivery. `apps/web` (Next.js) and `apps/mobile` (Expo React Native) are replaced by `apps/app` (Expo Router SDK 51+), which targets iOS, Android, and Web from a single TypeScript codebase. All other stack decisions (NestJS, PostgreSQL, Prisma, Redis, Turborepo) are unchanged.

---

## 20. Business Analyst Resolution Log (2026-03-22)

1. **SimBrief generation vs import:** MVP remains **import-only** (fetch latest OFP by pilot ID). OFP generation stays out of initial delivery.

2. **Airport data source:** OurAirports (CC0) remains the approved MVP seed source for airport metadata. AIRAC-level enrichment is deferred.

3. **Aircraft profiles and references:** Beyond user-defined profiles, aircraft references should support SimBrief aircraft and other publicly available aircraft documentation. AI-assisted aggregation is acceptable when reviewed by humans before shipping.

4. **SkyVector deep-link format:** Validation of the `?fpl=` pattern remains mandatory as a QA checkpoint before Phase 4 cutover. This is not a blocker for Phase 0.

5. **Branding source:** Until expanded brand assets are delivered, product UI should use Simulando channel branding as baseline (`https://www.youtube.com/@SimulandoMSFS`).

6. **i18n framework at scaffold time:** ~~`next-intl` approved for Phase 0~~ — **superseded by v0.5 revision.** `next-intl` is a Next.js-specific library incompatible with React Native. Replaced by `expo-localization + i18next`. Locales unchanged: `pt-BR` (default) + `en` active from Phase 0 re-execution. See §3 for rationale.
