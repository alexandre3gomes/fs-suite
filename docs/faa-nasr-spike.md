# Spike — FAA NASR ingestion (US vector VFR layer)

**Status:** spike / not started. This is the planned next step to give US users a
real, official, **in-map** VFR layer — without any raster hosting or new cost.

## Goal

Evaluate ingesting **FAA NASR** (public-domain US aeronautical data) as a
**lightweight vector layer** (GeoJSON) for the map — starting small — and measure
size, ingestion, performance and viability **before** committing to a full build.
This is the official counterpart to the worldwide OpenAIP community overlay.

Fits the model as `US_AIRSPACE` / `US_AIRPORTS` / `US_NAVAIDS` /
`US_REPORTING_POINTS` (`provider = FAA_NASR`, `geometryType = VECTOR_GEOJSON`,
`isOfficial = true`). See `docs/vfr-layer-model.md`.

## Hard constraints

- **Zero cost.** Vector only (small), stored in the existing Postgres. No large
  raster, no R2 tile hosting, no CDN/Worker. (See the cost stance in the model doc.)
- **Don't break Brazil** (REA/WAC) or any current VFR flow.
- **No overengineering** — one dataset first, measured, then decide.

## Start small — pick ONE dataset first

Recommended first slice: **US airports (APT)** — simplest, well-bounded (~20k US
landing facilities), high user value, point geometry (cheap). Alternative first
slice: navaids (small) or VFR reporting points.

> **Note on airspace:** Class B/C/D + Special Use **boundaries are NOT in the
> classic NASR fixed-width files** — they come from FAA's separate aeronautical
> **shapefiles** (Class Airspace / SUA). So `US_AIRSPACE` is a different source
> than `US_AIRPORTS`/`US_NAVAIDS` and should be its own spike slice.

## Source

- FAA NASR Subscription (public domain): https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/
- Format: layered fixed-width / CSV (`APT`, `NAV`, `FIX`, etc.); **28-day cycle**.
- FAA Class Airspace / SUA shapefiles (for `US_AIRSPACE`, separate).
- Licensing: **US public domain** — no commercial restriction, no attribution required.

## Proposed approach (mirrors the OurAirports seed pattern)

1. A seed/ingest script downloads + parses the chosen NASR file → Postgres table(s).
2. Serve a **viewport-bounded GeoJSON** endpoint (e.g. `GET /v1/vfr-layers/us/airports?bbox=`)
   — bounded by map bounds so payloads stay small.
3. Render as a `VECTOR_GEOJSON` layer in `AerodromeMap` (behind the catalog),
   toggle in the US group. No raster.

## What to MEASURE (the spike deliverable)

- Download size + parse complexity/effort (fixed-width quirks).
- Row count + **Postgres storage** added.
- Ingest time (full reload) + how a 28-day refresh would run (cron cost = zero?).
- **GeoJSON payload size for a typical viewport** + Leaflet render performance
  (markers/clustering needed?).
- Query latency (with a spatial/bbox index).

## Decision gate

Proceed to full implementation **only if** storage + payloads + render stay within
zero-cost/Postgres-free-tier comfort and data quality is good. Otherwise: keep US
on OpenAIP (community) + external official chart links, and document as a gap.

## Out of scope (for the spike)

- Raster charts (external links only).
- All US vector types at once (start with one).
- Europe.
- AIRAC automation beyond a manual/cron reload.
