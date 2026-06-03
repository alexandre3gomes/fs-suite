# VFR published-layer model (worldwide)

FS Suite started Brazil-first (REA, WAC, DECEA charts). This document defines the
**generic model for published VFR aeronautical layers** so the product can grow
to the US and Europe **without removing or degrading the Brazilian layers**.
REA, REH and WAC are now expressed as **Brazilian specializations** of one
generic model — not a Brazil-coupled subsystem.

> **Non-negotiable:** the current REA display and navigation must keep working
> exactly as before. This model is **additive** — a metadata/catalog layer on top
> of the existing REA/WAC implementations, with an adapter. No REA endpoint,
> graph, altitude or validation logic was changed.

## 0. Cost stance — no raster hosting (while zero-cost is a hard constraint)

**Decision:** while the project must run at **zero operational cost**, FS Suite
will **not host worldwide raster chart tiles** (FAA Sectional/TAC, etc.). We do
**not** download/serve them as tiles in R2, do **not** proxy or cache external
tiles, and do **not** stand up a Cloudflare Worker tile proxy. Hosting the US
VFR tile set would blow the R2 free tier (storage + read ops) and compete with
the chart-overlay/feedback buckets.

Instead:
- **Vector data** (lightweight: airspaces, airports, navaids, reporting points,
  routes) is the worldwide direction — official where available (FAA NASR), or
  community (OpenAIP, non-official) — because vectors are tiny vs raster tiles.
- **Per-aerodrome charts** are already discovered the **same way as DECEA**: the
  `/aerodromes/:icao/charts` endpoint + chart panel work for US airports too
  (FAA d-TPP — airport diagram, approaches, etc.). No US-specific UI needed.
- **Area VFR raster (sectional/TAC)** is **not hosted** — the route-on-sectional
  view is reached via the external **“Open in SkyVector”** link only. **SkyVector
  is a link target, never a tile source** (proprietary tiles; no
  embedding/scraping/proxy/cache).

This is revisited only if a real storage budget is approved.

## 1. The model

A published VFR layer is described by a normalized **`VfrLayerDescriptor`**
(`packages/types/src/schemas/vfr-layer.ts`), independent of country/source:

| Field | Meaning |
|-------|---------|
| `id` | stable catalog id (e.g. `br-rea`) |
| `name` | human label |
| `country` | ISO 3166-1 alpha-2 (`BR`, `US`, `ES`…) |
| `region` | sub-national scope (`TMA-SP`) or `null` = nationwide |
| `source` | human source label (e.g. `DECEA GeoAISWEB`) |
| `provider` | `VfrLayerProvider` enum (see below) |
| `layerType` | `VfrLayerType` enum (see below) |
| `geometryType` | `VfrLayerGeometryType` enum |
| `cycle` / `effectiveDate` | currency — AIRAC cycle or effective date (sources differ) |
| `minAltitude` / `maxAltitude` | operational band (optional) |
| `requiresClearance` | optional |
| `mandatory` | optional (layer-level; REA enforces per-segment) |
| `isOfficial` | `false` for community sources (e.g. OpenAIP) |
| `disclaimer` | shown when not official |
| `access` | how the client reaches the data: `{ endpoint? wmsUrl? wmsLayers? tileUrl? }` |

### Taxonomy — `VfrLayerType`

- **Brazil (DECEA):** `BR_REA`, `BR_REH` (reserved), `BR_WAC`
- **United States (FAA NASR vector):** `US_AIRSPACE`, `US_AIRPORTS`, `US_NAVAIDS`, `US_REPORTING_POINTS`, `US_VFR_FLYWAY`, `US_VFR_TRANSITION_ROUTE`
- **Europe:** `EU_AIRSPACE`, `EU_VRP`, `EU_VFR_TRANSIT_ROUTE`
- **Generic:** `LOCAL_VISUAL_ROUTE`

### Geometry — `VfrLayerGeometryType`

`VECTOR_GEOJSON` · `RASTER_WMS` · `RASTER_TILE` · `PDF_OVERLAY` ·
`EXTERNAL_LINK` (official raster chart reached via external link — **never hosted**)

### Provider — `VfrLayerProvider`

`DECEA_GEOAISWEB` · `FAA_NASR` · `FAA_VFR_RASTER` · `EUROCONTROL_EAD` ·
`NATIONAL_AIP` · `OPENAIP` (community / non-official) · `LOCAL`

## 2. Catalog (discovery)

`GET /v1/vfr-layers?country=BR` returns `VfrLayerDescriptor[]`
(`apps/api/src/vfr-layers/`). This is **metadata/discovery only** — it does not
serve geometry. Today it classifies the layers we already expose:

| layerType | geometry | data path (unchanged) |
|-----------|----------|-----------------------|
| `BR_REA` | `VECTOR_GEOJSON` | `/v1/rea/*` (REA service — corridors, graph, navigation) |
| `BR_WAC` | `RASTER_WMS` | DECEA WMS, rendered client-side |

The catalog is **static in code** for now (no DB table) — that lands when real
multi-region data does. Adding a new region is one more descriptor with
`country !== 'BR'`; nothing in the catalog is coupled to Brazil (proven by
`vfr-layers.catalog.spec.ts`, which validates a `US_VFR_FLYWAY` against the same
schema).

## 3. Rendering on the map (Leaflet)

The model maps onto the existing renderers — `geometryType` decides which:

- `VECTOR_GEOJSON` → GeoJSON / polygons (how REA corridors already render).
- `RASTER_WMS` / `RASTER_TILE` → WMS/tile overlay (how WAC already renders).
- `PDF_OVERLAY` → `L.imageOverlay` (how aerodrome VAC charts already render).

Client overlays are annotated with `{ country, provider, isOfficial, layerType }`
(`AerodromeMap.tsx` `DECEA_CHART_OVERLAYS`) — **annotation only**, toggles and
visuals are unchanged. The user can still turn **“REA”** on specifically; the
annotation enables future **country-grouped** layer toggles without depending on
the name “REA”.

## 4. Sources per region

| Region | Official sources | Notes |
|--------|------------------|-------|
| **Brazil** | DECEA GeoAISWEB (REA `ICA:CV_REA_BR_COMPLETO`, REH, WAC WMS, visual charts), AISWEB | Implemented: REA (vector) + WAC (WMS). REH reserved. |
| **USA** | FAA NASR (vector: airspace, airports, navaids, reporting points, flyways, transition routes); FAA d-TPP (per-aerodrome charts); FAA VFR Raster Charts (Sectional/TAC) | Per-aerodrome charts **already work** (FAA d-TPP via `/aerodromes/:icao/charts`, same as DECEA). NASR vector ingestion **deferred** — see `docs/faa-nasr-spike.md`. Area raster (sectional) is **not hosted** — external SkyVector route link only. |
| **Europe** | EUROCONTROL EAD, national AIPs, national WMS/WFS where available, VRPs, VFR transit routes | Model-ready, **not implemented**; per-country provider abstraction; licensing varies per state. |
| **Community** | OpenAIP | Worldwide airspace/airports/navaids/VRPs — **already in the app** as the “Worldwide airspace (OpenAIP)” toggle. `isOfficial=false` + disclaimer; never presented as official. |

### What's live now (zero cost)

- **Brazil:** REA + WAC, unchanged.
- **Worldwide:** OpenAIP overlay (relabelled “Worldwide airspace (OpenAIP)”), covering US/EU airspace + airfields + navaids + VRPs — community, non-official.
- **Per-aerodrome charts (US):** already work via the existing chart panel — pick a US airport and its FAA d-TPP charts (airport diagram, approaches…) appear, exactly like DECEA charts for Brazil.
- **External link (no hosting):** “Open in SkyVector” opens the route on the FAA sectional in a new tab. Tiles are never embedded, proxied, or cached.

## 5. Gaps / open items

- **US/EU are model-only** — no data ingestion yet (FAA NASR parsing, EAD/AIP
  access, WMS/WFS endpoints, licensing review per state).
- **WAC has no backend** — it's a client-side DECEA WMS layer; the catalog
  describes it but the tile list still lives in `AerodromeMap.tsx`.
- **REH not implemented** — reserved in the taxonomy only.
- **AIRAC:** only REA invalidates by cycle today; the descriptor carries
  `cycle`/`effectiveDate`, but per-source currency handling is per-provider and
  TBD for US/EU.
- **Licensing:** FAA data is US public domain; DECEA terms apply for Brazil;
  EUROCONTROL/national AIPs vary and need review before ingestion; OpenAIP is
  community-sourced (non-official).
- **No DB table yet** — catalog is static; promote to a table when multi-region
  data and admin curation are needed.
