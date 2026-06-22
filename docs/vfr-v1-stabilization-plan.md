# FS Suite — VFR v1 Stabilization Plan

## Purpose

This document converts the current product analysis into implementation priorities
for stabilizing the first usable VFR flight planning release.

The source of truth for product scope remains:

- `docs/project-spec.md`
- `docs/technical-spec.md`
- `docs/vfr-flight-planning-spec.md`

This plan does not expand scope. It narrows execution around the VFR v1 flow.

## Current Diagnosis

The repository already contains a broad VFR planning implementation with map,
weather, REA, aerodrome charts, SimBrief, SkyVector, AI validation, exports,
admin, feedback, and infrastructure support.

The immediate delivery risk is not missing features. The risk is that the VFR
flow is larger than the approved v1 scope and concentrated in a few large files,
especially:

- `apps/app/src/components/vfr/VfrPlanForm.tsx`
- `apps/app/src/components/vfr/AerodromeMap.tsx`
- `apps/app/src/components/vfr/vfrNavigation.ts`

The v1 objective is a reliable, web-usable VFR planning flow:

1. Select origin, destination, and alternate aerodromes.
2. Load aerodrome data and METAR.
3. Suggest runway in use when data allows.
4. Fill route, visual references, cruise level, and TOD.
5. Calculate fuel, reserve, contingency, per-wing quantity, and endurance.
6. Complete manual briefing checklist.
7. Save and reopen the plan.

## Non-Goals For This Stabilization Cycle

Do not add or expand:

- Premium features.
- Social/community features.
- Multiplayer or real-time tracking.
- FlightAware.
- New AI behavior.
- New SimBrief or SkyVector capabilities.
- New aerodrome chart automation.
- Mobile-only behavior.
- Major visual redesign unrelated to VFR usability.

Existing advanced features may remain in the codebase if removing them would
increase risk, but they must not block or complicate the v1 path.

## Priority 1 — Freeze And Clarify VFR v1 Scope

Make the primary create/edit VFR path match `docs/vfr-flight-planning-spec.md`.

Expected outcome:

- The user can complete the v1 flow without using SimBrief, SkyVector, AI,
  chart overlays, advanced REA tooling, or export modals.
- Advanced features are visually secondary, behind explicit actions, or marked
  as non-essential/experimental where appropriate.
- User-facing copy remains Brazilian Portuguese.

Acceptance criteria:

- A first-time user can find "Novo Planejamento VFR" and finish the core flow.
- Empty states and validation errors do not imply unavailable automations are
  required.
- The flow still works when advanced integrations are unavailable.

## Priority 2 — Reduce `VfrPlanForm.tsx` Complexity

Refactor incrementally. Do not rewrite the entire flow in one change.

Suggested extraction order:

1. Pure calculation helpers:
   - fuel calculation
   - endurance formatting
   - visual reference timing
   - route payload mapping
2. Feature panels:
   - aerodrome/weather section
   - route/visual references section
   - fuel/endurance section
   - briefing checklist section
   - advanced integrations/export section
3. API mapping helpers:
   - form state to API payload
   - API response to form state

Acceptance criteria:

- Each extraction preserves existing behavior.
- New helpers are covered by focused unit tests when they contain business
  logic.
- Refactors avoid changing database schema unless necessary for a documented
  bug.

## Priority 3 — Add Tests Around The Essential VFR Flow

Prioritize tests that protect user-visible behavior and operational calculations.

Minimum recommended coverage:

- Fuel calculation:
  - reserve 30 minutes
  - reserve 45 minutes
  - 10% contingency
  - required total
  - per-wing quantity
  - endurance minutes and `hh:mm`
- Plan payload mapping:
  - create payload includes aerodromes, route, visual references, fuel, and
    briefing items
  - edit/reopen maps persisted routes back into form state
- API service behavior:
  - create/list/get/update/delete/duplicate plan ownership rules
  - soft delete excludes deleted plans
- VFR UI smoke/e2e:
  - login/dev-login path if available
  - create VFR plan
  - reopen saved plan

Acceptance criteria:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- Add targeted e2e only when the local app/API setup is stable enough for the
  changed area.

## Priority 4 — Secret And Configuration Hygiene

Move hardcoded external keys or provider-specific settings out of source code
when they are not intentionally public constants.

Known item to review:

- `apps/app/src/components/vfr/AerodromeMap.tsx` currently contains an OpenAIP
  tile API key inline.

Acceptance criteria:

- Public frontend configuration uses `EXPO_PUBLIC_*`.
- Required variables are documented in the relevant `.env.example`.
- Missing optional keys fail gracefully and do not break the v1 flow.

## Priority 5 — Documentation Alignment

Keep docs honest about the current product stage.

Recommended updates:

- If advanced features remain, distinguish "implemented/experimental" from
  "required for VFR v1".
- Update README only when behavior or setup changes.
- Document any new folder or helper extraction introduced during refactors.

Acceptance criteria:

- `docs/vfr-flight-planning-spec.md` remains the scope reference for v1.
- This stabilization plan is updated when priorities materially change.

## Working Rules

- Keep changes small and reviewable.
- Do not revert unrelated local changes.
- Prefer shared Zod contracts and UI primitives.
- Preserve `apps/app` and `apps/api` boundaries.
- Keep web-first behavior working before considering native-specific polish.
- Run the most targeted validation for each change, plus broader validation
  before handing off.
