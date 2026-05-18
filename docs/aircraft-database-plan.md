# Aircraft Database — Dynamic & Backend-Driven Architecture

## Context

Aircraft data is currently a hardcoded static array (`apps/app/src/data/aircraftCatalog.ts`) with 27 aircraft. The `AircraftProfile` Prisma model is anemic, and performance data is lost when saving plans.

**Goal**: Transform the aircraft system into a dynamic, multi-source database. The `AircraftProfile` table will be seeded with a diverse catalog derived from industry-standard APIs and open-source performance models.

### Data Sources for Seeding

To ensure maximum diversity and accuracy, the initial seed will merge data from:
1.  **SimBrief API**: Primary source for ICAO codes, manufacturer names, and standard weight limits (MTOW, MZFW).
2.  **POHPerformance**: Gold standard for GA (General Aviation) VFR performance tables and Weight & Balance (W&B) stations.
3.  **OpenAP**: Aerodynamic coefficients and fuel flow models for commercial and executive jets.
4.  **Little Navmap Performance**: Community-sourced profiles for rare or specialized aircraft.

---

## Phase 1 — Expand AircraftProfile schema

**File**: `apps/api/prisma/schema.prisma`

Add fields to `AircraftProfile`:

```prisma
model AircraftProfile {
  id            String   @id @default(cuid())
  name          String                          // display name e.g. "Cessna 172S Skyhawk SP"
  icaoType      String?  @map("icao_type")
  manufacturer  String?
  model         String?
  emptyWeightKg Float?   @map("empty_weight_kg")
  mtowKg        Float?   @map("mtow_kg")
  fuelCapacityL Float?   @map("fuel_capacity_l")
  fuelBurnLph   Float?   @map("fuel_burn_lph")
  cruiseSpeedKts Int?    @map("cruise_speed_kts")
  stations      Json?                           // WeightStation[] as JSON
  source        String?                         // "simbrief", "poh", "manual", "internal"
  isTemplate    Boolean  @default(false) @map("is_template")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  userId        String?  @map("user_id")        // null = system template
  user          User?    @relation(...)

  flightPlans   FlightPlan[]

  @@map("aircraft_profiles")
}
```

---

## Phase 2 — Multi-Source Ingestion Engine

**File**: `apps/api/prisma/seed-aircraft.ts`

Instead of a static array, implement an ingestion script that:
1.  **Fetches SimBrief Supported Aircraft**: Call `https://www.simbrief.com/api/xml.fetcher.php?json=1&supported_aircraft=1` to get the latest list of ~200+ supported ICAO types.
2.  **Enriches GA Types**: Cross-reference SimBrief ICAO codes with `POHPerformance` data to inject accurate W&B stations for common VFR aircraft (C152, C172, P28A, etc.).
3.  **Enriches Jet Types**: Use `OpenAP` data to provide realistic fuel burn and cruise speeds for commercial/executive aircraft.
4.  **Preserves Legacy**: Include the existing 27 aircraft as "high-fidelity" internal templates.

**Strategy for Maximum Diversity**:
- Use SimBrief as the "skeleton" (all ~250 aircraft types).
- Use POH/OpenAP as the "muscle" (adding performance/W&B to the skeleton).
- Flag records with `source: "simbrief"` if they only have basic weights, and `source: "internal"` for fully detailed profiles.

---

## Phase 3 — Backend API & Snapshotting

**Endpoints**:
- `GET /v1/aircraft-profiles/catalog`: Returns the full seeded catalog.
- `POST /v1/aircraft-profiles/:id/clone`: Clones a template for user customization.

**FlightPlan Snapshotting**:
- `FlightPlan` model must store a full copy of all performance fields at the moment of saving. This prevents old flight plans from breaking when a template is updated.

---

## Phase 8 — AI Analysis Enrichment (Grounding)

**File**: `apps/api/src/ai-validation/ai-validation.service.ts`

Update `buildUserPrompt` to leverage the full `AircraftProfile` data when available.

1.  **Context Injection**: If `dto.aircraftProfileId` is provided, fetch the full profile from the database.
2.  **Performance Grounding**: Pass the exact `fuelBurnLph`, `emptyWeightKg`, and `stations` (JSON) to the prompt.
3.  **Prompt Instruction**: Update the user prompt to tell the AI: *"Use os dados técnicos exatos da aeronave fornecidos abaixo para validar o planejamento de combustível e peso/balanceamento, priorizando-os sobre seus conhecimentos genéricos."*

---

## Instructions for Implementation Agent

1.  **Prioritize Breadth**: Ensure the `seed-aircraft.ts` script pulls the full list from SimBrief.
2.  **Surgical Enrichment**: Map the detailed stations from `apps/app/src/data/aircraftCatalog.ts` to the correct ICAO types.
3.  **JSON Robustness**: Use Zod schemas in the API to validate the `stations` JSON field.
4.  **Preserve Prompt Quality**: **DO NOT** rewrite the `system-prompt.ts`. The current "Brazilian Flight Instructor" persona and regulatory framework (ICAs, RBACs) are highly refined and must be preserved. Only append the new dynamic data to the *User Prompt* section so the AI can use it as grounding context.
5.  **Caching**: Implement 24h caching for the catalog endpoint.

---

## Execution Order

1.  **Schema migration** — Add new fields to `AircraftProfile` and `FlightPlan`.
2.  **Ingestion Script** — Build `seed-aircraft.ts`.
3.  **Backend Implementation** — Controller and Service updates.
4.  **AI Enrichment** (Phase 8) — Inject dynamic performance data into the AI validation flow.
5.  **Frontend Switch** — Update `AircraftSelect.tsx`.
6.  **Cleanup** — Remove static catalog after verification.
