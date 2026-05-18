# Aircraft Database — Architecture & Contracts

## Data Source Hierarchy

The system ingests aircraft data from multiple sources to maximize catalog diversity:
- **Curated (internal)** — Hand-verified GA aircraft with full W&B. Source: `curated`.
- **SimBrief API** — ~250+ ICAO types and weight limits. Source: `simbrief`.
- **POHPerformance** — GA VFR performance and W&B stations. Source: `poh_ai`.
- **OpenAP** — Aerodynamic coefficients and fuel flow for jets. Source: `openap`.

---

## Domain Model

Three distinct concepts, each with its own shared contract:

### Catalog Entry (Template)
System-managed, read-only for end users. `isTemplate: true`.

**Contract**: `AircraftCatalogEntry` — returned by `GET /aircraft-profiles/catalog`.

### User Profile
Cloned from a catalog template or created manually. Owned by a user. `isTemplate: false`.

**Contract**: `UserAircraftProfile` — returned by `GET /aircraft-profiles`, `POST`, `PATCH`, `POST .../clone`.

### Flight Plan Snapshot
Performance data frozen at plan save time. Prevents historical plans from breaking when profiles change. Includes flight-specific fields (`takeoffWeightKg`, `callsign`, `registration`).

**Contract**: `FlightPlanAircraftSnapshot` — embedded inside `FlightPlan`.

---

## Contract Architecture

All shared types live in `packages/types/src/schemas/aircraft-profile.ts`.

### Response contracts

```
AircraftBaseFields          ← shared performance/identification fields
├── AircraftCatalogEntry    ← + isTemplate: true
└── UserAircraftProfile     ← + isTemplate: false, clonedFromId
```

`AircraftBaseFields` contains: `id`, `name`, `icaoType`, `manufacturer`, `model`, performance fields (`emptyWeightKg`, `mtowKg`, `fuelCapacityL`, `fuelBurnLph`, `cruiseSpeedKts`), `stations`, `source`, `dataCompleteness`, timestamps.

`AircraftCatalogEntry` extends base with `isTemplate: literal(true)`.

`UserAircraftProfile` extends base with `isTemplate: literal(false)` and `clonedFromId: string | null`.

The literal `isTemplate` discriminant makes the two types structurally distinct — you cannot pass a user profile where a catalog entry is expected, and vice versa.

### Input contracts

```
CreateAircraftProfileInput   ← Zod-inferred, source of truth for create payloads
UpdateAircraftProfileInput   ← Partial<Create>, source of truth for update payloads
```

### NestJS DTOs (`apps/api/src/aircraft-profiles/dto/`)

```
WeightStationDto             implements WeightStation       (Swagger only)
CreateAircraftProfileDto     implements CreateAircraftProfileInput
UpdateAircraftProfileDto     implements UpdateAircraftProfileInput
```

DTOs use `@Allow()` from class-validator (whitelisting for the global pipe) and `@ApiProperty` (Swagger docs). They are **not** the validation authority — Zod schemas are.

### Runtime Validation

Validation runs through a `ZodValidationPipe` applied at the parameter level on create/update endpoints:

```
Request body
  → Global ValidationPipe (whitelist + transform via @Allow() decorators)
  → ZodValidationPipe (validates against CreateAircraftProfileSchema / UpdateAircraftProfileSchema)
  → Route handler
```

The Zod schemas in `packages/types` are the single source of truth for runtime validation. DTOs exist solely for Swagger documentation and global pipe whitelisting.

### Persistence model (`@prisma/client`)

Two Prisma models for aircraft data:

- **`AircraftProfile`** — Single table for both templates and user profiles (discriminated by `isTemplate` column). Contains internal field `userId` not exposed in public contracts.
- **`AircraftProfileStation`** — Relational model for weight & balance stations. FK to `AircraftProfile` with cascade delete. Maps `stationId` ↔ `WeightStation.id`.

All queries use `include: { stations: true }` to eagerly load stations. The service exports `AircraftProfileWithStations` as the typed intersection of both models.

### Shared enums

- `DataCompleteness`: `skeleton | partial | complete` — computed from core performance fields.
- `EnrichmentSource`: `curated | simbrief | openap | lnm | poh_ai | user` — tracks data origin.

---

## Data Flow

```
Request  →  CreateAircraftProfileInput (shared contract)
         →  ZodValidationPipe (validates against Zod schema)
         →  Global ValidationPipe (whitelist via @Allow())
         →  Prisma create() with nested stations: { create: [...] }
         →  AircraftProfile + AircraftProfileStation[] (persistence)
         →  toUserProfile() mapper (maps AircraftProfileStation → WeightStation)
         →  UserAircraftProfile (API response)

Catalog  →  Prisma findMany({ isTemplate: true, include: { stations: true } })
         →  toCatalogEntry() mapper
         →  AircraftCatalogEntry (API response)
```

The `baseFields()` helper extracts common fields from the Prisma record, maps `AircraftProfileStation[]` to `WeightStation[]`, and narrows string columns to their typed equivalents. `toCatalogEntry()` and `toUserProfile()` add the discriminant and type-specific fields.

---

## API Endpoints

| Endpoint | Input | Response | Concept |
|----------|-------|----------|---------|
| `GET /aircraft-profiles/catalog` | — | `AircraftCatalogEntry[]` | Catalog |
| `GET /aircraft-profiles` | — | `UserAircraftProfile[]` | Profile |
| `POST /aircraft-profiles/:id/clone` | — | `UserAircraftProfile` | Profile |
| `POST /aircraft-profiles` | `CreateAircraftProfileInput` | `UserAircraftProfile` | Profile |
| `PATCH /aircraft-profiles/:id` | `UpdateAircraftProfileInput` | `UserAircraftProfile` | Profile |
| `DELETE /aircraft-profiles/:id` | — | `void` | Profile |

---

## Caching

- **Catalog**: Redis key `aircraft:catalog`, TTL 24h. Invalidated on template changes.
- **Weather**: Separate concern — see weather service documentation.
