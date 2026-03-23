# Decisions

Use this file to record closed decisions after they are resolved in `docs/comms/inbox.md`.

---

## Decision 001 — Technical Spec v0.3 accepted as product-aligned

- Date: 2026-03-21
- Participants: Analista de negocio, Arquiteto
- Status: resolved
- Files: `docs/technical-spec.md`

### Summary

`docs/technical-spec.md` v0.3 was reviewed by the Analista de negocio and accepted as aligned with `docs/project-spec.md`.

Revisions applied across v0.1 → v0.3:
- SimBrief scope reduced to import-only for MVP; generation deferred pending API validation
- SimBrief endpoint contract standardised (pilot ID via `IntegrationConnection`, single `GET /v1/integrations/simbrief/ofp` endpoint)
- Refresh token session lookup fixed: refresh token is now a signed JWT (RS256) containing `sid` (sessionId), enabling session lookup without access token
- Refresh token storage policy consolidated: raw token never persisted; only bcrypt hash stored in `Session.refreshTokenHash`
- Token reuse detection moved to DB-only (bcrypt mismatch on existing row); Redis blacklist removed
- Branding formalised as a technical requirement with definition-of-done checklist; Phase 2 blocked on receipt of Simulando brand assets
- Posthog and Storybook reclassified as "Recommended" infra, not required for MVP launch
- OurAirports (CC0) approved as airport seed source; future update strategy documented

### Open questions resolved in Decision 003 (see below)

1. SimBrief import-only — acceptable for MVP?
2. Airport data — OurAirports sufficient, or AIRAC data required for IFR routes?
3. Aircraft profiles — user-defined only for MVP?
4. SkyVector deep-link format — QA validation needed
5. Branding assets — timeline for delivery from Simulando channel team
6. i18n framework — scaffold `next-intl` from Phase 0?

---

## Decision 002 — `docs/comms/` adopted as default agent handoff channel

- Date: 2025-03-21
- Participants: Analista de negocio, Arquiteto
- Status: resolved
- Files: `docs/comms/README.md`, `docs/comms/inbox.md`, `docs/comms/decisions.md`, `docs/comms/template.md`

### Summary

The repository communication protocol defined in `docs/comms/README.md` was acknowledged by the Arquiteto and adopted as the default asynchronous handoff process between agents.

Agreed usage:
- `docs/comms/inbox.md` for active requests, handoffs, and pending responses
- `docs/comms/decisions.md` for resolved outcomes and accepted decisions
- `docs/comms/template.md` as the standard format for new entries

This protocol is the default path for future coordination involving specification review, architecture clarification, implementation handoff, and cross-agent decision closure.

---

## Decision 003 — BA resolutions for Section 19 and implementation clearance

- Date: 2026-03-22
- Participants: Analista de negocio, Desenvolvedor
- Status: resolved
- Files: `docs/technical-spec.md`, `docs/comms/inbox.md`

### Summary

The pending Business Analyst responses requested in Entry 001 were provided, and implementation is cleared to proceed from Phase 0.

Resolved directives:
- SimBrief remains import-only for MVP.
- Aircraft references should include SimBrief aircraft and other publicly available aircraft documentation, with AI-assisted aggregation allowed under human review.
- SkyVector deep-link validation remains a QA checkpoint before Phase 4 cutover and is not a Phase 0 blocker.
- Branding direction should use Simulando channel branding (`https://www.youtube.com/@SimulandoMSFS`) until a more complete asset package is delivered.
- i18n framework decision is confirmed: scaffold and implement `next-intl` with `pt-BR` and `en` active in MVP.

---

## Decision 004 — Phase 0 handoff to Desenvolvedor

- Date: 2026-03-22
- Participants: Arquiteto, Desenvolvedor
- Status: resolved
- Files: `docs/technical-spec.md` v0.4, `docs/comms/inbox.md` Entry 002

### Summary

Arquiteto reviewed `docs/technical-spec.md` v0.4 and confirmed all documents are consistent and ready for implementation. Phase 0 is formally handed off to the Desenvolvedor.

**Verification summary:**
- `technical-spec.md` v0.4: status "Cleared for implementation"; all Section 19 open questions resolved and logged
- `decisions.md`: Decisions 001–003 recorded and closed
- `project-spec.md`: functional spec intact, unmodified
- `CLAUDE.md`: comms protocol and agent rules documented

**Phase 0 scope handed off:**
- Turborepo scaffold (`apps/web`, `apps/api`, `apps/mobile`, `packages/ui`, `packages/types`, `packages/config`)
- `packages/config`: TypeScript strict, ESLint, Tailwind, Prettier
- `packages/types`: Zod schemas + enums (`FlightType`, `PlanStatus`, `OAuthProvider`)
- Docker Compose: PostgreSQL 16 + Redis 7
- CI pipeline: lint → typecheck → build (GitHub Actions)
- `next-intl` in `apps/web` with `pt-BR` and `en` from scaffold

**Constraints for Desenvolvedor:**
- Spec reference: all implementation must trace to `docs/technical-spec.md` v0.4
- SimBrief: import-only; no generation endpoint to implement
- Branding: use Simulando channel as baseline until official asset pack is delivered
- SkyVector deep-link: QA gate before Phase 4, not a Phase 0 concern
- Any architectural question or blocker must be raised via `docs/comms/inbox.md` directed to Arquiteto

---

## Decision 005 — Phase 0 completed by Desenvolvedor

- Date: 2026-03-22
- Participants: Desenvolvedor
- Status: resolved
- Files: `apps/`, `packages/`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`

### Summary

Phase 0 scaffold fully implemented by Desenvolvedor per Decision 004 handoff scope. All checklist items completed and typecheck passing.

**Delivered artifacts:**
- Turborepo monorepo with pnpm workspaces — 7 workspace packages, 1449 dependencies installed
- `packages/config`: TypeScript configs (base, nextjs, nestjs, react-library), ESLint configs, Tailwind base with CSS custom property design tokens
- `packages/types`: Zod schemas for all domain entities and enums, integration contracts (SimBrief, SkyVector), pagination helpers
- `packages/ui`: aviation dark cockpit design tokens (placeholder, pending Simulando brand assets), MVP component set (Button, Card, Badge, Input, Spinner)
- `apps/api`: NestJS 10 with Helmet, CORS, ValidationPipe, Swagger; complete Prisma schema matching `technical-spec.md` Section 5; seed stub for Phase 3
- `apps/web`: Next.js 14 App Router with `[locale]` routing, `next-intl` (`pt-BR` default + `en`), all route placeholders, login page scaffold, globals.css with aviation tokens
- `apps/mobile`: Expo SDK 51 scaffold structure only (not implemented in MVP per spec)
- `docker-compose.yml`: PostgreSQL 16 + Redis 7 with healthchecks
- `.github/workflows/ci.yml`: lint → typecheck → build → test pipeline
- `.env.example` for root, `apps/api`, and `apps/web`; `.gitignore` updated

**Typecheck status:** `packages/types`, `packages/ui`, `apps/api`, `apps/web` — all passing, zero errors.

**Next phase ready:** Phase 1 — Auth (NestJS Google OAuth, JWT RS256, Prisma migrations, Next.js login flow).

---

## Decision 006 — Phase 0 validated by Arquiteto

- Date: 2026-03-22
- Participants: Arquiteto
- Status: resolved
- Files: all Phase 0 artifacts

### Summary

Arquiteto performed a full content-level validation of Phase 0 deliverables against `docs/technical-spec.md` v0.4. Phase 0 is approved.

**All checklist items from Entry 002 verified and approved.** Key confirmations:
- Prisma schema matches spec §5 exactly: `refreshTokenHash` (not raw token), `lastUsedAt`, soft deletes, correct indexes and unique constraints
- `packages/types` covers all domain entities and integration contracts; SimBrief schema is import-only (no generation schema present)
- `packages/ui` tokens include placeholder annotation referencing spec §12 branding block
- `apps/web` i18n: `next-intl` with `pt-BR` (default) + `en` active from scaffold
- CI pipeline structure: lint + typecheck parallel → build → test, with `--frozen-lockfile`

**Two attention items flagged for Phase 1 (non-blockers):**
1. `turbo.json` `globalEnv` contains `NEXTAUTH_URL` and `NEXTAUTH_SECRET` — likely template residue; must be removed and replaced with correct JWT/OAuth env vars when auth module is implemented
2. CI `test` job may fail with no tests present — add `--passWithNoTests` flag to Vitest config in Phase 1 when test infrastructure is wired

**Phase 1 (Auth) is cleared to begin.**

---

## Decision 007 — Frontend stack revision approved for single app codebase

- Date: 2026-03-23
- Participants: Analista de negocio, Arquiteto
- Status: resolved
- Files: `docs/technical-spec.md`, `docs/project-spec.md`, `docs/comms/inbox.md`

### Summary

The frontend stack revision proposed in Inbox Entry 004 is approved. The repository technical reference moves from the previous dual-frontend plan (`apps/web` in Next.js + `apps/mobile` in Expo scaffold) to a single `apps/app` based on Expo Router targeting iOS, Android, and Web from one TypeScript codebase.

**Approved outcomes:**
- `docs/technical-spec.md` v0.5 becomes the active technical reference
- `packages/ui` migration to React Native primitives + NativeWind is accepted with explicit effort, acceptance criteria, and migration scope
- `next-intl` is formally superseded by `expo-localization + i18next`, keeping `pt-BR` and `en`
- SSR/SSG, NativeWind coverage, and `react-native-web` behavior trade-offs are formally recorded

**Business alignment recorded:**
- `docs/project-spec.md` received an addendum superseding the previous stack recommendation in sections §10 and §17
- Product direction remains web-first, but with a single reusable frontend codebase and near-term native mobile readiness
- MVP priorities remain unchanged: authentication, dashboard, and flight planning

**Execution impact acknowledged:**
- Phase 0 frontend scaffold is partially re-executed
- `apps/web` and `apps/mobile` are replaced by `apps/app`
- `apps/api`, `packages/types`, infrastructure, and backend direction remain unchanged

---

## Decision 008 — Phase 0 re-exec completed (Expo Router scaffold)

- Date: 2026-03-23
- Participants: Desenvolvedor
- Status: resolved
- Files: `apps/app/`, `packages/ui/`, `packages/config/`, `turbo.json`, `docs/comms/inbox.md`

### Summary

Phase 0 re-execution completed per Entry 005 scope and `docs/technical-spec.md` v0.5. All checklist items delivered.

**Delivered artifacts:**
- `apps/web` and `apps/mobile` deleted
- `apps/app` created: Expo Router SDK 51+, targets web/iOS/Android, file-based routing with `(public)/login` and `(auth)` group (dashboard, flight-plans, flight-plans/new, flight-plans/[id], profile)
- `apps/app/app.json`: scheme `fssuite`, web bundler metro, static output, plugins expo-router + expo-secure-store, typed routes enabled
- `apps/app/src/i18n`: `expo-localization + i18next + react-i18next`, locales `pt-BR` (default) + `en`, translation keys for all routes
- `apps/app/metro.config.js` + `babel.config.js`: NativeWind v4 integration
- `apps/app/tailwind.config.js`: extends base config with NativeWind preset
- `packages/ui`: all 5 components rewritten with React Native primitives (View, Text, Pressable, TextInput, ActivityIndicator) + NativeWind className. Zero React DOM imports or HTML elements.
- `packages/config/typescript/expo.json`: new tsconfig profile (jsx: react-native, moduleResolution: bundler, noEmit: true)
- `packages/config/package.json`: export for `./typescript/expo` and `./tailwind/tailwind.config` added
- `packages/config/tailwind/tailwind.config.js`: NativeWind preset added, CSS custom properties replaced with literal color values
- `turbo.json`: `NEXTAUTH_URL` and `NEXTAUTH_SECRET` removed; `EXPO_PUBLIC_API_URL` added

**Typecheck status:** packages/types PASS, packages/ui PASS, apps/api PASS, apps/app PASS — all zero errors.

**Phase 1 (Auth) is cleared to begin.**

---

## Decision 009 — Phase 0 scaffold corrections applied

- Date: 2026-03-23
- Participants: Arquiteto, Desenvolvedor
- Status: resolved
- Files: `packages/config/eslint/`, `apps/api/`, `apps/app/`, `packages/types/`, `packages/ui/`, `AGENTS.md`, `docs/technical-spec.md`, `.npmrc`

### Summary

Six scaffold issues reported by Desenvolvedor in Entry 006 were identified and corrected. All monorepo validation commands now pass.

**Validation after corrections:**
- `pnpm run lint` → PASS
- `pnpm run typecheck` → PASS
- `pnpm run test` → PASS
- `pnpm run build` → PASS (apps/api + apps/app)

**Changes applied:**
1. **ESLint 9 flat config** — `packages/config/eslint/{base,nestjs,react-library}.js` rewritten as flat config arrays; `eslint.config.js` added to all linted workspaces; `--ext` flags removed from lint scripts
2. **Frontend build coverage** — `"build"` script added to `apps/app/package.json` so Turbo includes it in the build pipeline
3. **Expo build fix** — placeholder PNG assets created in `apps/app/assets/`; `metro.config.js` updated with `watchFolders` and `resolver.nodeModulesPaths` for pnpm monorepo symlink resolution; `.npmrc` added with `node-linker=hoisted`
4. **Test CI fix** — `vitest run --passWithNoTests` in `apps/api` prevents exit code 1 with no test files
5. **Docs aligned** — `AGENTS.md` updated to reference `apps/app`; `technical-spec.md` §14 updated to reference `@sentry/react-native` instead of Next.js SDK
6. **Git consolidation** — pending: a single commit consolidating the full Phase 0 re-exec state is required before Phase 1 begins

**Phase 1 (Auth) is cleared to begin after git consolidation commit.**

---

## Decision 010 — Post-correction validation of Phase 0 scaffold

- Date: 2026-03-23
- Participants: Desenvolvedor
- Status: resolved
- Files: `apps/app/`, `apps/api/`, `packages/config/eslint/`, `AGENTS.md`, `docs/comms/inbox.md`

### Summary

The repository was revalidated after the corrections recorded in Decision 009.

**Validated commands:**
- `pnpm run lint` → PASS
- `pnpm run typecheck` → PASS
- `pnpm run test` → PASS
- `pnpm run build` → PASS
- `pnpm --filter @fs-suite/app run build:web` → PASS

**Residual note (non-blocking):**
- Expo web export still emits repeated routing warnings from the root layout because `apps/app/app/_layout.tsx` declares `Stack.Screen name="(public)"`, while the actual public route present is `(public)/login/index`. Build succeeds and static export is generated, but the route-group declaration should be normalized before Phase 1 auth flow expands.

**Outcome:**
- No blocking validation failures remain.
- Repository is operationally ready to proceed to Phase 1, with the Expo Router warning tracked as a cleanup item.

---

## Decision 010 — Expo Router route-group warning resolved; phase mapping documented

- Date: 2026-03-23
- Participants: Arquiteto
- Status: resolved
- Files: `apps/app/app/(public)/_layout.tsx`, `docs/technical-spec.md`, `docs/comms/inbox.md`

### Summary

Two non-blocking issues from Entry 007 and Entry 008 resolved.

**Entry 007 — Expo Router route-group warning:**
`apps/app/app/(public)/_layout.tsx` created with a pass-through Stack navigator, mirroring the existing `(auth)/_layout.tsx` pattern. The `(public)` group now has a proper layout entry point; the `No route named "(public)"` warning is eliminated. Build re-validated: clean with no routing warnings.

**Entry 008 — Phase numbering misalignment:**
`docs/project-spec.md` is read-only; no changes made there. `docs/technical-spec.md` §18 updated with an explicit phase mapping table explaining that the technical decomposition (Phases 0–5) maps to the product roadmap phases (Fases 0–3) at a finer granularity. MVP functional priorities are unchanged.

**Repository state:** all validations passing, no open blocking items. Phase 1 (Auth) cleared to begin.
