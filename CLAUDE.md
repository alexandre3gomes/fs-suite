# CLAUDE.md

## Project Overview

**FS Suite** is a flight simulation planning and management platform built for the "Simulando" channel community. It provides virtual pilots with a unified experience for flight planning, operational consultation, and integrations with established ecosystem tools (SimBrief, SkyVector, FlightAware).

The project is currently in the **specification/initialization phase** — the spec is defined but implementation has not started yet.

## Architecture

Turborepo monorepo with the following structure:

```
fs-suite/
├── apps/
│   ├── web/       # Next.js — dashboard and flight planning UI
│   ├── mobile/    # Expo React Native — iOS/Android (future phase)
│   └── api/       # NestJS — business logic and integrations
├── packages/
│   ├── ui/        # Shared design system and components
│   ├── types/     # Shared TypeScript types and API contracts
│   └── config/    # Shared configuration
└── docs/
    └── project-spec.md  # Full product spec (in Portuguese)
```

## Tech Stack

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Web         | Next.js (TypeScript)              |
| Mobile      | Expo React Native                 |
| API         | NestJS (TypeScript)               |
| Database    | PostgreSQL + Prisma ORM           |
| Cache/Queue | Redis                             |
| Monorepo    | Turborepo                         |
| Auth        | Google OAuth (backend-implemented)|
| Language    | TypeScript (full stack)           |

## MVP Scope

1. **Authentication** — Google OAuth login, account creation, session management
2. **Dashboard** — Authenticated user overview with module cards
3. **Flight Planning Module** — Origin/destination, aircraft profile, route, VFR/IFR type
4. **SimBrief Integration** — Import or generate OFP data
5. **SkyVector Integration** — Open route in contextual link
6. **Flight History** — Save, list, reopen, and duplicate flight plans

**Out of MVP scope:** social features, marketplace, real-time multiplayer, premium plans, push notifications, full offline support, FlightAware integration (phase 2).

## Domain Entities

- `User`, `OAuthAccount`, `Session`
- `AircraftProfile`, `FlightPlan`, `FlightPlanRoute`
- `Airport`, `IntegrationConnection`, `ActivityLog`

## Key Design Decisions

- **Web-first** with real architecture preparation for mobile (shared `packages/ui` and `packages/types`)
- **NestJS API** keeps integration and business logic separate from UI clients
- **TypeScript everywhere** reduces friction across web, mobile, and backend
- **Turborepo** enables efficient task caching and cross-package orchestration

## Development Commands

> Commands will be available once the monorepo is initialized. Expected patterns:

```bash
# Root (all apps)
npm run dev        # Start all services
npm run build      # Build all packages
npm run test       # Run tests across monorepo
turbo run <task>   # Run a specific Turborepo task

# apps/web
npm run dev        # Next.js dev server
npm run build      # Production build

# apps/api
npm run dev        # NestJS dev server
npm run build      # Production build

# apps/mobile
npx expo start     # Expo dev server
```

## Development Guidelines

- Language for code and technical documentation: **English**
- User-facing content language: **Brazilian Portuguese** (pt-BR)
- Responsive design: desktop and tablet from the start; mobile-friendly web before native app
- Visual identity: aviation/cockpit aesthetic — avoid generic SaaS dashboard look
- LGPD compliance must be considered from the initial data modeling
- Observability (error tracking and basic event logging) required from the first deploy

## External Integrations

| Service     | Phase | Purpose                                  |
|-------------|-------|------------------------------------------|
| SimBrief    | MVP   | Import/generate OFP flight plan data     |
| SkyVector   | MVP   | Contextual route and airport visualization |
| FlightAware | v2    | Flight tracking and operational reference |

## Agent Role and Workflow Rules

These rules govern how Claude Code operates in this project:

1. **Functional specs are read-only.** `docs/project-spec.md` is owned by the product/business team and must never be modified. Claude Code must not alter functional requirements under any circumstance.

2. **Technical spec is Claude Code's output.** `docs/technical-spec.md` is proposed by Claude Code based on the functional spec. It represents technical decisions, architecture, data models, and implementation details that satisfy the functional requirements.

3. **Review cycle.** Every change to `docs/technical-spec.md` must be submitted for review by the business analyst before implementation begins. Implementation work should only proceed after explicit approval.

4. **Separation of concerns.** If a functional requirement is unclear or technically ambiguous, Claude Code must raise it as an open question in the technical spec (Section 17 or equivalent), never silently interpret or extend the functional scope.

5. **Spec-driven implementation.** All implementation tasks (code, migrations, configs) must trace back to an approved section of `docs/technical-spec.md`. Changes that lack a spec reference should not be implemented.

## Inter-Agent Communication Protocol

Cross-agent coordination happens asynchronously via repository files in `docs/comms/`:

- **`docs/comms/inbox.md`** — active messages, handoff requests, and review submissions between agents
- **`docs/comms/decisions.md`** — closed decisions and resolved outcomes
- **`docs/comms/template.md`** — standard format for new entries

**Required behaviour for Claude Code (Arquiteto role):**
- Read `docs/comms/inbox.md` at the start of any session involving cross-agent work
- When submitting a spec revision for review, add an entry to `inbox.md` directed to `Analista de negocio`
- When a review cycle closes, record the outcome in `decisions.md` and mark the inbox entry as resolved
- Never assume a prior conversation is visible to another agent — all context must be captured in the comms files

## Project Spec

Full specification is in [docs/project-spec.md](fleet-file://j5gtpp5qn49l01qm1jdf/Users/alexandre/desenv/projects/personal/fs-suite/docs/project-spec.md?type=file&root=%252F) (Portuguese).

## Technical Spec

Technical specification (proposed by Claude Code, pending analyst review) is in [docs/technical-spec.md](fleet-file://j5gtpp5qn49l01qm1jdf/Users/alexandre/desenv/projects/personal/fs-suite/docs/technical-spec.md?type=file&root=%252F).
