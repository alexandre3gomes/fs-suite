# ADR-002: Production Technology Stack

**Date:** 2026-05-27 (retrospective — decisions taken at project inception)
**Status:** Accepted

## Context

FS Suite is a flight simulation planning and management platform for the
"Simulando" channel community. At the moment of inception, the
constraints driving the technology choices were:

- **Solo developer.** A single maintainer covering frontend, backend,
  infra, and ops. Cognitive load and context-switching cost dominate
  everything else.
- **Multi-platform from day one.** Web (desktop pre-flight planning) and
  mobile (cockpit consultation) must share UI and behaviour. iOS and
  Android shipping later from the same codebase.
- **No paying users yet.** Free tiers across providers matter more than
  raw scale or throughput. Recurring cost must stay under ~$15/month.
- **Aviation domain.** Highly relational data model (airports, runways,
  frequencies, aircraft, plans, briefings), multiple external
  integrations (SimBrief, SkyVector, DECEA, AVWX, OpenWeatherMap), and
  conformity to ICAO regulations that change rarely but matter
  absolutely when they do.
- **LGPD compliance.** Brazilian user data with soft deletes,
  token encryption at rest, opt-in analytics, retention policies.
- **Visual identity.** Aviation/cockpit aesthetic — not a generic SaaS
  dashboard. Component library must allow heavy custom styling.

## Decision

The stack chosen and its rationale, layer by layer:

| Layer | Choice | Driving reason |
|-------|--------|----------------|
| Mobile + Web | **Expo + React Native + TypeScript** | One codebase for web/iOS/Android. Solo dev cannot maintain three native apps + a web app. Expo Web is mature enough for the planning UI. |
| API | **NestJS** | Opinionated framework — fewer decisions to make alone. Modules + DI scale with the number of integrations. Decorator-based DTOs pair naturally with Zod + Swagger for contract enforcement. |
| Database | **PostgreSQL 16 + Prisma ORM** | Aviation data is relational by nature (FKs everywhere). Prisma generates TypeScript types that feed the shared `packages/types`, closing the loop end-to-end. |
| Cache | **Redis 7** | Refresh-token sessions, SimBrief import dedup, auth-code exchange (ADR-001), response cache. All ephemeral, all key-value. |
| Monorepo | **Turborepo + pnpm** | `packages/types` (Zod schemas) is the single source of truth for API/app contracts. pnpm for disk efficiency and strict resolution. Turbo for incremental builds. |
| Database host | **Supabase** | Managed Postgres with first-class backup, Storage for the `db-backups` bucket, service-role auth for automation. Free tier (500 MB) covers the current phase; payment cliff is around launch. |
| Cache host | **Upstash** | Serverless Redis, pay-per-use, free tier of 256 MB and 500K commands/day. No standing instance to manage. |
| API host (primary) | **EC2 t3.small** | Predictable cost (~$15/month), Docker Compose simplicity, full control. Suits the constant-traffic workload of a community tool. |
| API host (candidate) | **Cloud Run** | Scale-to-zero (free when idle) for failover. Cold starts of ~1–2 s on Node are acceptable for the candidate role. WIF auth keeps the pipeline keyless. |
| Frontend host | **Cloudflare Pages** | Free, edge global, native integration with the Cloudflare zone already in place. |
| DNS + TLS + CDN | **Cloudflare** | Origin Certificate avoids Let's Encrypt on EC2. Proxied DNS gives DDoS protection. R2 stores the chart-overlay cache with no egress cost. Workers serve `api-candidate.fs-suite.com`. |
| Auth | **Google OAuth (Passport.js)** | Zero password storage burden. Target users almost certainly have Google accounts. Passport is the Nest-native choice. |
| CI/CD | **GitHub Actions** | Repo is public → unlimited Actions minutes. No external runner service to learn. |
| Observability | **Sentry + PostHog** | Sentry's free tier covers both backend (Node SDK) and frontend (JavaScript SDK) under one DSN. PostHog free tier handles 1M events/month, more than enough at this stage. |

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| **Java + Spring Boot for the API** | Loses end-to-end type sharing with the React Native frontend (would need OpenAPI codegen or duplicated contracts). Cloud Run cold starts on Spring Boot are 5–15 s — incompatible with the EC2/Cloud Run failover topology. JVM memory footprint is large for a t3.small (2 GB RAM, shared with nginx). None of the JVM strengths (JIT, threading, mature transactional ecosystems) apply to the CRUD + HTTP-integration workload here. |
| **Python + FastAPI** | Strong on the integration side and excellent for typed APIs, but no clean way to share types with a TypeScript frontend, and packaging/deployment is heavier than Node. Would also force a second language across the codebase. |
| **Go for the API** | Performance and binary size would be wins, but the trade in iteration speed for a solo developer (verbose error handling, less ergonomic ORM story than Prisma) is not worth it for CRUD-shaped workload. |
| **Next.js (instead of Expo)** | Solves only the web side. Mobile would require a separate codebase or React Native Web bridge — back to maintaining two apps. Expo Web closes the gap with one stack. |
| **Vercel (instead of Cloudflare Pages)** | Pages is comparable in DX and free, but the rest of the stack (DNS, R2, Workers) is already on Cloudflare. Vendor concentration on one provider is the explicit trade — see consequences below. |
| **Self-hosted Postgres on EC2** | Saves the Supabase free tier ceiling but adds backup, monitoring, and upgrade burden onto the solo dev. The Supabase managed offering with built-in Storage for backups removed an entire ops surface. |
| **Self-hosted Redis on EC2** | Same trade as Postgres. Upstash's free tier is generous enough that running Redis in the same compose file would only save complexity to lose it elsewhere (cap planning, persistence, replication). |
| **Fastify or Hono (lighter Node frameworks)** | Less boilerplate per route, but no first-class DI/module system. Nest's opinionation is what makes the solo-dev codebase organised — that's the feature, not the cost. |
| **AWS Cognito / Auth0 for auth** | Cognito is rough on developer ergonomics; Auth0 hits its free-tier MAU cap fast and adds a billing surface. Passport + Google OAuth is enough for the scope. |
| **Stripe Sigma / dedicated analytics SaaS** | Overkill at zero MRR. PostHog covers both product analytics and basic funnels for free until well past launch. |

## Consequences

### Positive

- **End-to-end type safety.** A field rename in a Zod schema breaks both API validation and app compile-time. Catches integration bugs at PR time, not in production.
- **Single brain, single language.** Frontend and backend share idioms, tooling (pnpm, ESLint, Prettier, TS config), testing patterns. Context-switching cost is minimal.
- **Operational floor of ~$15/month.** EC2 t3.small is the only standing charge. Supabase, Upstash, Cloudflare, Cloud Run, GitHub Actions, Sentry, PostHog all run on free tiers at current usage.
- **Multi-platform shipping path.** Web is live today; iOS and Android are an EAS build away from the same codebase.
- **Failover is real, not paper.** EC2 → Cloud Run swap is one DNS change or one `EXPO_PUBLIC_API_URL` edit. Cloud Run is continuously deployed, smoke-tested, and reachable via `api-candidate.fs-suite.com`.

### Negative

- **Vendor concentration on Cloudflare.** DNS, TLS, CDN, Pages, R2, Workers all on one provider. If Cloudflare degrades, multiple layers degrade together. Mitigated by Cloudflare's own SLO and by the fact that the blast radius is shared with ~25% of the public web.
- **Free-tier cliff.** Several providers hit upgrade limits roughly simultaneously as the product grows (Supabase at 500 MB, Upstash at 256 MB, Cloud Run egress, PostHog at 1M events). Need a pricing-aware capacity plan before public launch.
- **NestJS verbosity.** A route + DTO + service + module in Nest is more code than the equivalent in Hono or Fastify. Trade taken on purpose — the structure pays off as the codebase grows.
- **JVM strengths are absent.** If the domain evolves toward computation-heavy work (multi-aircraft route optimisation, simulation), Node may not be the right home for that subsystem. Acceptable today; a re-evaluation trigger to keep in mind.
- **Expo Web ≠ native performance.** The web bundle is React Native rendered through `react-native-web`, not a Next.js-style SSR app. Initial load is heavier than a pure web framework would deliver. Tolerable for a planning tool, not for a content-marketing landing page.

### Reversal cost

- **API framework or language**: high. Migrating off NestJS/Node would require rewriting every route + service + integration; nothing about the data model or frontend is tied to it, so it can be done module by module — but it's months of work, not weeks.
- **Database**: medium. Prisma's schema is portable to any Postgres-compatible store. Migrating off Postgres entirely would touch the schema heavily.
- **Mobile/web framework**: high. Migrating off Expo means re-implementing the UI in another framework or splitting web from mobile.
- **Hosting provider**: low. EC2 → any VM provider is `setup.sh` away. Cloud Run → any container platform same. Cloudflare Pages → any static host. The infra layer is the most replaceable.

## Re-evaluation triggers

The stack is appropriate as long as the project remains in the
"solo developer + community tool + early traction" zone. Re-evaluate
the stack (or specific layers) if any of these become true:

- The team grows beyond two engineers — opinionated frameworks matter less, ecosystem maturity matters more.
- The workload becomes compute-heavy (route optimisation, simulation, real-time ATC).
- Monthly cost crosses ~$200 — at that point, picking specifically for cost-efficiency at scale starts mattering.
- A specific integration (DECEA, FAA, EUROCONTROL) forces a JVM library with no Node alternative.
- LGPD audit or aviation certification work requires a stack with a clearer regulatory track record.

Until one of those triggers fires, this stack is the answer.
