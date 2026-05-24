# Aerodrome chart overlay — architecture decisions

This document records the structural decisions behind rendering aerodrome
charts (VAC) as transparent overlays on the VFR planning map.

## Goal

From the VFR planning flow, a pilot should be able to:

- Select a VAC chart already shown in the chart panel for an aerodrome in
  the plan (origin, destination, or alternate).
- Project it as a transparent overlay on the route map with **zero manual
  setup** — no admin tooling, no calibration step, no curated registry.
- Adjust opacity and toggle visibility while flying the plan.

## Scope of the MVP

| Chart type | In MVP? | Reason |
|------------|---------|--------|
| VAC | yes | Primary candidate for overlay |
| PDC | no | Out of scope; reconsider later |
| ADC | no | Aerodrome ground layout — doesn't georeference cleanly to the route map |
| IAC / SID / STAR / MIN | no | Not visual-flight charts |

Only one overlay is active at a time.

## Architecture: on-demand, automatic, cached

The feature is **fully automatic** from the user's perspective. There is
no offline preparation step, no JSON registry to edit, no admin UI, no
human-in-the-loop. When the user clicks "Mostrar no mapa", the backend
computes the overlay on demand and the result is cached so the next
request is instant.

### Pipeline (per request)

```
ChartsPanel button click
   │
   ▼
GET /aerodromes/:icao/chart-overlay?url=...&type=VAC&name=...
   │
   ├─ DB cache hit (sourceUrl + AIRAC cycle)? ──► return DTO
   │
   └─ Cache miss:
        1. Validate URL host (DECEA, FAA, ENAIRE, ...)
        2. Load Airport + Runways from DB
        3. Compute bounds (see below)
        4. Download PDF
        5. Rasterize page via pdfjs-dist + @napi-rs/canvas
        6. Optimize PNG via sharp
        7. PUT to R2 (key includes AIRAC cycle)
        8. Upsert AerodromeChartOverlay row
        9. Return DTO
```

### Bounds computation

We derive bounds entirely from data we already store:

- `Airport.latitude`, `Airport.longitude` — the ARP, used as the overlay
  center.
- `Runway.lengthFt` — the longest runway, used to size the overlay.

Heuristic:

```
sideNm = max(longestRunwayNm × 4, 3 NM)   // empirical scale factor
halfNm = sideNm / 2
latDelta = halfNm / 60
lonDelta = halfNm / (60 × cos(lat))
bounds = ARP ± (latDelta, lonDelta)
```

Brazilian VAC charts are north-up and roughly centered on the field, so a
square box scaled by runway length produces a usable approximation for
all 324 Brazilian aerodromes in our DB. Imperfect placement is fine — the
opacity slider lets the pilot fade the overlay against the base map to
judge how well it lines up.

### Rotation

Skipped. DECEA VAC charts publish north-up. If we later integrate a chart
authority that rotates charts to align with the active runway, we'd
extract rotation from the PDF metadata; not needed for MVP.

### Caching

Two layers:

1. **R2** stores the rasterized PNG. Key:
   `chart-overlays/{AIRAC cycle}/{ICAO}/{sha1(chartUrl)[0..11]}.png`
   The cycle is in the path so a new AIRAC produces a fresh raster
   side-by-side with the previous one.
2. **`aerodrome_chart_overlays` (PostgreSQL)** records the metadata for
   each cached raster (one row per `(sourceUrl, preparedAiracCycle)`).
   This is the lookup index for cache hits and stores the bounds, image
   dimensions, and authority.

When the AIRAC cycle advances, existing rows are simply never matched on
lookup — they aren't deleted, but they aren't served either. The first
request for any chart after a cycle change triggers a fresh raster. (A
sweep job to delete old R2 objects is a future optimization.)

### PDF rasterization

- `pdfjs-dist` (legacy/Node build) loads and renders the page.
- `@napi-rs/canvas` provides the canvas backend pdfjs needs in Node.
- `sharp` (already a runtime dep) compresses the final PNG.

Both `pdfjs-dist` and `@napi-rs/canvas` are runtime dependencies of the
API. They add ~30–50 MB to the Docker image. Loaded via dynamic `import`
so cold starts that don't render charts aren't slowed down.

Poppler was rejected because it requires a system binary and inflates
the Docker image with apt/apk packages; pdfjs + @napi-rs/canvas ship as
self-contained npm packages with prebuilt binaries.

### Frontend integration

- `ChartsPanel` shows the **"📍 Mostrar no mapa"** button on every chart
  whose `type === 'VAC'`. No prefetch of overlay lists — the button is
  always available for VAC charts.
- Click → `requestOverlay(chart)` calls the on-demand endpoint, shows a
  loading state for the ~1–3s first-render case, then lifts the result
  into `VfrPlanForm`.
- `VfrPlanForm` holds the single active overlay and passes it to
  `AerodromeMap`. When origin/destination/alternate changes and the
  active overlay's ICAO drops off the plan, the overlay clears silently.
- `AerodromeMap` renders the overlay via `L.imageOverlay` with `zIndex:
  500` (above tiles, below markers and route).

The active overlay is identified to ChartsPanel by `sourceUrl`, which is
stable across re-fetches and survives the round-trip through the backend.

## Backend contract

| Method | Path | Description |
|--------|------|-------------|
| GET | `/aerodromes/:icao/chart-overlay?url=...&type=...&name=...` | Compute or fetch from cache; returns ChartOverlayDto |
| GET | `/aerodromes/chart-overlays/:id/image` | Stream the cached PNG from R2 |

`/aerodromes/:icao/chart-overlay` is not idempotent in the strict sense
(it may create a cache row + R2 object on first call) but is safe and
side-effect-free from the caller's perspective.

## Operational notes

- **AIRAC rollover**: nothing automatic to manage. Next request after the
  rollover triggers a fresh raster; old rows linger harmlessly until a
  cleanup job is added.
- **Adding new aerodromes**: no action needed. If the airport is in the
  `airports` table (we have ~85k worldwide, 324 BR) and has at least one
  runway, the overlay works.
- **Adding new chart sources**: extend `ALLOWED_HOSTS` in
  `chart-overlays.service.ts`. The `ChartsService` discovery is already
  multi-authority.

## Out of scope (deliberately)

- Client-side recalibration (drag handles, anchor points, blend modes).
- Multiple simultaneous overlays.
- Admin/curation UI.
- Native (iOS/Android) builds of the map — overlay inherits the map's
  web-only state. Will revisit alongside any native map effort.
- OCR-based extraction of printed coordinate grids from chart PDFs (could
  improve accuracy beyond the runway-length heuristic).

## Known limitations

- Bounds are approximate, not exact. Cartas mostly centered on the field
  with a scale band wide enough that mid-zoom situational awareness
  works; tight 1:1 alignment requires either OCR (future) or interactive
  calibration (also future).
- Runway thresholds in our database are sourced from OurAirports and may
  drift over time as magnetic declination shifts (this is a broader DB
  freshness concern, tracked separately).
