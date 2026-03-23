# Inbox

Use this file for active communication between agents.

---

## Entry 001
- Date: 2026-03-21
- From: Desenvolvedor
- To: Arquiteto, Analista de negocio
- Status: resolved
- Action: Acknowledge the addition of the Desenvolvedor agent to the team. Confirm whether `docs/technical-spec.md` v0.3 (accepted via Decision 001) is cleared for implementation to begin, or if any open questions from Section 19 must be resolved first.
- Context: The Desenvolvedor agent is now active in the repository. The technical spec was accepted in Decision 001, but six open questions remain pending BA response. Before starting implementation (Phase 0 scaffold or any MVP module), the Desenvolvedor needs to know which items are blockers vs. acceptable to proceed without.
- Files: `docs/technical-spec.md`, `docs/comms/decisions.md`

### Response
- Date: 2026-03-22
- From: Analista de negocio
- Outcome: Implementation is cleared to start from Phase 0.
- Decisions:
  - SimBrief remains import-only in MVP.
  - Aircraft data should support SimBrief aircraft and other public aircraft documentation sources; assisted compilation with AI is acceptable with human review.
  - SkyVector deep-link validation remains a QA action before Phase 4 cutover and is not a Phase 0 blocker.
  - Branding source is Simulando channel branding (`https://www.youtube.com/@SimulandoMSFS`) until an expanded brand asset pack is provided.
  - `next-intl` is approved in Phase 0 with Portuguese (`pt-BR`) and English (`en`) implemented from the start.

---

## Entry 002
- Date: 2026-03-22
- From: Analista de negocio
- To: Arquiteto, Desenvolvedor
- Status: open
- Action: Start Phase 0 execution according to `docs/technical-spec.md` v0.4 and report completion status by checklist item.
- Context: BA decisions for previous open questions were resolved and implementation is cleared. This handoff formalizes Phase 0 kickoff with required scope boundaries for MVP.
- Files: `docs/technical-spec.md`, `docs/project-spec.md`, `docs/comms/decisions.md`

### Checklist for kickoff
- [ ] Scaffold Turborepo monorepo with planned apps and packages (`apps/web`, `apps/api`, `apps/mobile`, `packages/ui`, `packages/types`, `packages/config`).
- [ ] Configure TypeScript strict mode and shared lint/format setup in `packages/config`.
- [ ] Initialize `packages/types` with base shared Zod schemas and enums.
- [ ] Add local infrastructure baseline with Docker Compose for PostgreSQL and Redis.
- [ ] Create CI baseline (`lint`, `typecheck`, `build`) aligned with monorepo tasks.
- [ ] Scaffold `next-intl` in `apps/web` with active locales `pt-BR` and `en` from the start.
- [ ] Keep SimBrief scope import-only in initial integration contracts.
- [ ] Use Simulando channel branding baseline until expanded brand assets are provided.
- [ ] Keep SkyVector link validation as QA gate before Phase 4; do not block Phase 0.

### Response (Arquiteto)
- Date: 2026-03-22
- From: Arquiteto
- Status: resolved

Spec verificada. `docs/technical-spec.md` v0.4 está íntegra e pronta para implementação. Resumo da verificação:

**Estado dos documentos:**
- `technical-spec.md` v0.4: status "Cleared for implementation", todas as questões abertas da Section 19 resolvidas e registradas
- `decisions.md`: Decision 001 (spec aceita) e Decision 003 (resoluções do BA) registradas
- `project-spec.md`: funcional, read-only, inalterado
- `CLAUDE.md`: protocolo de comms documentado

**Decisões BA incorporadas na v0.4:**
- SimBrief: import-only confirmado — nenhum contrato de geração a implementar
- Aircraft: perfis user-defined + referências SimBrief e documentação pública, com revisão humana
- SkyVector: validação do deep-link é gate de QA antes da Phase 4, não bloqueia Phase 0
- Branding: baseline do canal Simulando (`@SimulandoMSFS`) até entrega do asset pack oficial
- i18n: `next-intl` com `pt-BR` e `en` ativos desde o scaffold (Phase 0)

**Checklist Phase 0 — liberado para execução:**
- [ ] Turborepo scaffold (`apps/web`, `apps/api`, `apps/mobile`, `packages/ui`, `packages/types`, `packages/config`)
- [ ] `packages/config`: TypeScript strict, ESLint, Tailwind, Prettier
- [ ] `packages/types`: Zod schemas base + enums (`FlightType`, `PlanStatus`, `OAuthProvider`)
- [ ] Docker Compose: PostgreSQL 16 + Redis 7
- [ ] CI: lint → typecheck → build (GitHub Actions)
- [ ] `next-intl` em `apps/web` com locales `pt-BR` e `en`

Outcome registrado em `decisions.md` (Decision 004). Desenvolvedor pode iniciar Phase 0.

### Response (Desenvolvedor)
- Date: 2026-03-22
- From: Desenvolvedor
- Status: resolved

**Phase 0 concluído.** Checklist de execução:

- [x] Turborepo scaffold — `apps/web`, `apps/api`, `apps/mobile`, `packages/ui`, `packages/types`, `packages/config`
- [x] `packages/config` — TypeScript strict (base, nextjs, nestjs, react-library), ESLint configs, Tailwind base config com design tokens via CSS custom properties
- [x] `packages/types` — Zod schemas (`User`, `Airport`, `AircraftProfile`, `FlightPlan`, `FlightPlanRoute`, `IntegrationConnection`), enums (`FlightType`, `PlanStatus`, `OAuthProvider`), schemas de integração (SimBrief, SkyVector), paginação
- [x] `apps/api` — NestJS scaffold com `AppModule`, `main.ts` (Helmet, CORS, ValidationPipe, Swagger), Prisma schema completo (`schema.prisma`) alinhado ao tech spec, `nest-cli.json`
- [x] `apps/web` — Next.js 14 App Router, estrutura `[locale]/(public)` e `[locale]/(auth)`, `next-intl` configurado com `pt-BR` (padrão) e `en`, mensagens i18n, design tokens em `globals.css`, middleware de locale
- [x] `apps/mobile` — Expo SDK 51 scaffold, `app.json`, placeholder `app/index.tsx` (não implementado em MVP)
- [x] `packages/ui` — design tokens (`tokens.ts`) com paleta aviation dark cockpit, componentes MVP: `Button`, `Card`, `Badge`, `Input`, `Spinner`
- [x] Docker Compose — PostgreSQL 16 + Redis 7 com healthchecks
- [x] CI GitHub Actions — `lint → typecheck → build → test` em paralelo onde possível
- [x] `.env.example` (raiz, api, web), `.gitignore` atualizado

**TypeCheck:** `packages/types`, `packages/ui`, `apps/api`, `apps/web` — todos passando sem erros.

**Pendências para próximas fases:**
- `pnpm-lock.yaml` gerado e dependências instaladas (1449 pacotes)
- Branding assets de `@SimulandoMSFS` aguardados para Phase 2 (tokens placeholder ativos)
- Prisma migrations serão geradas em Phase 1 com DB online
- Seed OurAirports implementado em Phase 3

Outcome registrado em `decisions.md` (Decision 005).

---

## Entry 003
- Date: 2026-03-22
- From: Arquiteto
- To: Desenvolvedor
- Status: resolved
- Action: Validação de entrega da Phase 0 pelo Arquiteto. Dois itens de atenção identificados para resolução em Phase 1.
- Files: todos os artefatos entregues em Phase 0

### Resultado: Phase 0 aprovada

**Itens verificados e aprovados**

**Monorepo / raiz**
- Turborepo 2.x, pnpm 9, Node >=20 — conforme spec §17
- `turbo.json` com tasks `build`, `dev`, `lint`, `typecheck`, `test`, `test:e2e`, `clean` — correto
- `.gitignore`, `.prettierrc.json`, `.prettierignore` — presentes e adequados

**packages/config**
- TypeScript configs (`base`, `nextjs`, `nestjs`, `react-library`) em strict mode — correto
- ESLint configs com cobertura por contexto de app — correto
- Tailwind base config com CSS custom properties — alinhado com spec §12

**packages/types**
- Enums `FlightType`, `PlanStatus`, `OAuthProvider` com valores corretos
- Schemas Zod para todas as entidades do domínio: `User`, `Airport`, `AircraftProfile`, `FlightPlan` + `FlightPlanRoute`, `IntegrationConnection`, `Pagination`
- Contratos de integração: SimBrief (import-only, sem schema de geração), SkyVector — alinhados com Decision 003

**packages/ui**
- `tokens.ts`: `colors`, `typography`, `spacing`, `radius` — checklist da spec §12 atendido
- Nota de placeholder referenciando spec §12 e bloqueio em assets Simulando — correto
- Componentes MVP: `Button`, `Card`, `Badge` (com variantes VFR/IFR), `Input`, `Spinner` — presentes

**apps/api**
- `main.ts`: Helmet, prefixo `/v1`, `ValidationPipe`, CORS, Swagger só em não-produção — conforme spec §11
- `app.module.ts`: `ConfigModule` global + `ThrottlerModule` (60 req/60s) com stubs dos módulos futuros
- `schema.prisma`: 9 modelos alinhados linha a linha com spec §5 — `Session.refreshTokenHash` (não raw token), `lastUsedAt`, soft delete em `User` e `FlightPlan`, `@@index([flightPlanId, sequence])`, `@@unique([userId, service])` em `IntegrationConnection`

**apps/web**
- Next.js 14 App Router com `[locale]` — correto
- `next-intl` com `pt-BR` (default) e `en` — conforme Decision 003
- Rotas: `(public)/login`, `(auth)/dashboard`, `(auth)/flight-plans`, `(auth)/profile` — alinhadas com spec §4.2
- `globals.css` com CSS custom properties consistentes com `packages/ui/tokens.ts`

**apps/mobile** — Expo SDK 51 scaffold-only conforme spec §2

**Docker Compose** — PostgreSQL 16 + Redis 7 com healthchecks e volumes — conforme spec §15

**CI** — lint + typecheck paralelos → build → test; `--frozen-lockfile`; dummy env vars para build — conforme spec §15

---

### Itens de atenção para Phase 1

**[ATENÇÃO 1] `turbo.json`: variáveis `NEXTAUTH_URL` e `NEXTAUTH_SECRET` no `globalEnv`**

`next-auth` não está na stack. Essas variáveis parecem resíduo de template. Em Phase 1, ao implementar o módulo de auth, remover essas entradas do `globalEnv` e substituir pelas variáveis corretas (ex: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`).

**[ATENÇÃO 2] CI: job `test` pode falhar por ausência de testes em Phase 0**

Nenhum pacote tem Vitest configurado ainda. Se o script `test` retornar erro por ausência de arquivos, o CI quebra. Em Phase 1, ao adicionar Vitest, garantir que o script `test` use `--passWithNoTests` ou equivalente nos pacotes sem cobertura ainda.

---

Outcome registrado em `decisions.md` (Decision 006). Phase 1 liberada.
