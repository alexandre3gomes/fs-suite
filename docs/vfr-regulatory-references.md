# VFR Regulatory References

Rules applied in the VFR flight planning module with their authoritative sources.
Each rule cites the regulation that governs it so deviations can be traced.

> **Governance rule:** No flight planning logic may be added or changed without
> first verifying conformity with the relevant ICAO/DECEA/ANAC document.
> Non-conforming changes must be refused even if requested by a stakeholder.

---

## 1. Flight Plan Form — Field 15: Route (ICAO Doc 4444 Appendix 2)

### 1.1 Cruising level encoding

| Altitude position | Format | Example | Notes |
|-------------------|--------|---------|-------|
| Below Transition Altitude | `A` + 3 digits (hundreds of feet) | `A045` = 4 500 ft QNH | ICAO Doc 4444 §2.3 |
| At/above Transition Altitude | `FL` + 3 digits (hundreds of feet) | `FL055` = FL055 (1013.25 hPa) | ICAO Doc 4444 §2.3 |
| VFR uncontrolled | literal `VFR` | `VFR` | ICAO Doc 4444 §2.3 |
| Speed (knots) | `N` + 4 digits | `N0110` | ICAO Doc 4444 §2.3 |

**Implementation decision (2026-05-14):** The app uses `FL` prefix (not bare `F`) for
flight levels, matching the standard used in Brazilian DECEA forms, IVAO, and VATSIM
practice. ICAO Doc 4444 §2.3 formally specifies `F` for the speed/level group, but
`FL` is universally understood and preferred by Brazilian ATC. The parser
(`parseCruiseLevelFt`) accepts both `FL045` and `F045` for backward compatibility.

**Transition altitudes per region:**

| Region | TA (ft) | Source |
|--------|---------|--------|
| Brazil (SB/SD/SI/SJ/SN/SS/SW) | 5 000 | AIP Brasil AD 2 (varies 3 000–7 000; 5 000 is the safest default) |
| USA/Canada (K/C prefixes) | 18 000 | FAA AIM §7-2-1 |
| All others | 5 000 (default) | Conservative fallback |

Code: `vfrNavigation.ts` — `TRANSITION_ALTITUDES`, `formatAltitudeIcao()`.

### 1.2 Coordinate format (11 characters)

```
ddmmN/S dddmmE/W
```

Example: `2312S05047W` = 23°12'S 050°47'W

Source: ICAO Doc 4444 Appendix 2, item (c).

Code: `vfrNavigation.ts` — `toVfrCoord()`.

### 1.3 DCT usage

**ICAO Doc 4444 rule:** DCT is inserted between successive points when the flight
to the next point will be outside a designated ATS route, **except** when both
points are defined by geographical coordinates — in that case DCT may be omitted.

**DECEA practice (Brazil):** DCT is used between all points **including**
consecutive coordinates, with a leading and trailing DCT. This is the format
observed in official DECEA publications and AIS examples.

**Implementation decision (2026-05-14):** The app follows DECEA practice:

```
DCT 2312S05047W DCT 2311S05039W DCT 2306S05021W DCT
```

- Leading `DCT` = direct from departure (Field 13) to first waypoint
- `DCT` between each coordinate = direct between successive waypoints
- Trailing `DCT` = direct from last waypoint to destination (Field 16)
- Simple direct flight (no waypoints) = `DCT`

Sources:
- ICAO Doc 4444 Appendix 2 (general rule)
- NexAtlas — "REA e REH: Voando em corredores visuais" (DECEA practice example)
- DECEA MCA 100-11 (Preenchimento de Planos de Voo)

Code: `vfrNavigation.ts` — `buildVfrRouteText()`.

### 1.4 REA corridors in the flight plan

**Key principle:** The REA corridor identifier does NOT appear in Field 15 (Route).
It belongs exclusively in Field 18 (Item 18 — Other Information) under `RMK/`.

| Field | Content | Example |
|-------|---------|---------|
| Field 15 (Route) | Coordinates of all gates/waypoints with DCT | `DCT 2312S05047W DCT 2311S05039W DCT 2306S05021W DCT` |
| Field 18 (Remarks) | `RMK/REA [corridor name]` | `RMK/REA GOLF` |

**Implementation decision (2026-05-14):** Previous version incorrectly placed `REA`
identifier in Field 15. Corrected after verifying against DECEA MCA 100-11 and
NexAtlas reference: "especifique no campo 15 (rota) as coordenadas dos portões e
posições que irá sobrevoar; no campo 18 (observações) os nomes dos corredores
utilizados."

Sources:
- DECEA MCA 100-11
- DECEA AIC-N-20/21 (Circulação VFR Integrada TMA-SP/TMA-RJ)
- NexAtlas — "REA e REH: Voando em corredores visuais"

Code: `vfrNavigation.ts` — `buildVfrRouteText()`, `buildItem18()`.

### 1.5 REA Navigation Engine

The REA Navigation Engine computes optimal routes through Brazil's REA corridor network
using a directed graph built from DECEA's authoritative WFS data.

#### 1.5.1 Data source

All corridor data is fetched from DECEA GeoAISWEB:

| Parameter | Value |
|-----------|-------|
| Service | WFS |
| Layer | `ICA:CV_REA_BR_COMPLETO` |
| Format | GeoJSON |
| Cache TTL | 7 days (Redis) |
| URL | `https://geoaisweb.decea.mil.br/geoserver/ICA/wfs` |

Each feature represents a corridor **segment** (trecho) with two fixes (A and B),
directional headings, altitude constraints, and a corridor polygon geometry.

#### 1.5.2 Directed graph construction

The graph is built from the WFS segments as follows:

1. **Nodes**: Each unique fix coordinate becomes a node. Key format: `lat.toFixed(4),lon.toFixed(4)` (~11m precision).
2. **Edges**: Directionality is determined by the `rumoa_to_b` and `rumob_to_a` fields:
   - `rumoa_to_b ≠ null` → create edge A→B with that heading
   - `rumob_to_a ≠ null` → create edge B→A with that heading
   - `rumoa_to_b = null` → direction A→B is **forbidden**
   - Both null → **bidirectional** (gate/transition segment, heading computed from coordinates)

The "both null = bidirectional" rule handles gate corridors (Portão) where DECEA does
not specify a direction restriction. These segments connect the corridor network to
aerodrome traffic patterns.

Each edge carries: corridor name, tipo (Obrig/Recom), heading, distance (NM),
altitude range (min/max per direction), compulsory altitude, trecho number, region ID.

Graph size for São Paulo (XP1): ~100 nodes, ~210 edges. Build time from cached WFS: <50ms.

#### 1.5.3 Route suggestion (Dijkstra)

`GET /v1/rea/navigate/suggest?origin=lat:lon&destination=lat:lon&altitude=ft`

1. **Snap origin** to nearest graph node within 10 NM
2. **Snap destination** to multiple candidates (top 6 nearest nodes within 10 NM)
3. **Dijkstra** from origin node to each destination candidate:
   - Weight = `distanceNm × tipoFactor + headingChangePenalty`
   - `tipoFactor`: 0.8 for Obrig (prefer mandatory corridors), 1.0 for Recom
   - Heading change >60°: +2 NM penalty; >120°: +5 NM (avoids zigzag routes)
   - Edges where altitude is outside `[altMin, altMax]` or mismatches `altComp` are excluded
4. **Best path** = candidate with lowest `graphDistance + snapDistance`

Multi-candidate snapping is critical: the nearest node by distance may require a long
detour through the graph (e.g., an orphan gate endpoint at 0.6 NM that needs a 37 NM
graph path), while a farther node (5 NM) may have a much shorter graph path (24 NM).

#### 1.5.4 Route validation

`GET /v1/rea/navigate/validate?waypoints=lat:lon,lat:lon,...&altitude=ft`

For each consecutive waypoint pair:
- Snap both to graph nodes
- Check if a forward edge exists → OK
- Check if only a reverse edge exists → **direction violation** (error)
- Check altitude against edge constraints → **altitude violation** (error)
- Check compulsory altitude match → **compulsory altitude violation** (error)
- Node not found → **outside REA coverage** (warning)

#### 1.5.5 Frontend integration

When the user selects a corridor to follow:

1. The corridor's far-end waypoint (graph-connecting node) is sent as origin
2. The destination airport coordinates are sent as destination
3. The API returns the optimal graph route
4. The frontend merges: corridor own waypoints + API graph route (deduplicating the shared node)
5. If the API fails or returns `found: false`, the corridor's own waypoints are used as fallback

#### 1.5.6 AIRAC lifecycle

A daily cron (`0 3 * * * UTC`) checks the `efetivacao` field of a sample region.
If a newer date is detected, the in-memory graph cache and all Redis REA keys are
invalidated. The next request rebuilds the graph from fresh WFS data.

Code: `rea-navigation.service.ts` — `buildGraph()`, `dijkstra()`, `suggestRoute()`, `validateRoute()`.

Sources:
- DECEA GeoAISWEB WFS — `ICA:CV_REA_BR_COMPLETO` (authoritative segment data)
- DECEA MCA 100-11 (corridor usage rules)
- DECEA AIC-N-20/21 (São Paulo / Rio TMA VFR integration)

---

## 2. Flight Plan Form — Field 18: Other Information (ICAO Doc 4444 Appendix 2)

### 2.1 Indicator order

ICAO Doc 4444 prescribes a specific order for Item 18 indicators:

```
DOF/YYMMDD PER/[cat] RMK/[free text]
```

### 2.2 Auto-generated indicators

| Indicator | Format | When generated | Source |
|-----------|--------|----------------|--------|
| `DOF/` | `DOF/YYMMDD` | Always (date of flight) | ICAO Doc 4444 §18 |
| `PER/` | `PER/A` through `PER/E` | When aircraft is selected | ICAO Doc 8168 (performance category from approach speed) |
| `RMK/REA [name]` | `RMK/REA DELTA ALT 2500/4500` | Following a REA corridor | DECEA MCA 100-11 |
| `RMK/CLB` or `RMK/DES` | `CLB 3500FT/4500FT ABV DUTRA` | Altitude transition between segments | Standard phraseology |

### 2.3 Altitude transitions in remarks

When a route has multiple altitude segments (e.g., free-flight → corridor → free-flight),
the transition points and altitudes are described in RMK/ as:

```
CLB [fromAlt]FT/[toAlt]FT ABV [fix]    (climb)
DES [fromAlt]FT/[toAlt]FT ABV [fix]    (descent)
```

These are derived from the user's actual per-segment altitude selections, not from
suggested defaults.

Code: `VfrPlanForm.tsx` — `altitudeTransitions` useMemo, `buildItem18()`.

---

## 3. VFR Semicircular Rule (Cruise Altitude)

### 3.1 ICAO standard (Annex 2, Table S3-1)

| Magnetic Course | VFR Level |
|-----------------|-----------|
| 000° – 179° | Odd thousands + 500 ft (3 500, 5 500, 7 500…) |
| 180° – 359° | Even thousands + 500 ft (4 500, 6 500, 8 500…) |

### 3.2 Brazil (ICA 100-12, §4.6)

Same direction split as ICAO, **maximum VFR level FL145** (14 500 ft).

### 3.3 Region-specific rules

| Region | ICAO prefixes | Odd range | Max VFR FL | Source |
|--------|---------------|-----------|------------|--------|
| Brazil | SB/SD/SI/SJ/SN/SS/SW | 000°–179° | FL145 | ICA 100-12 |
| ICAO default | (all others) | 000°–179° | FL195 | ICAO Annex 2 |
| USA/Canada | K/C/PA/PH… | 000°–179° | FL175 | FAA FAR 91.159 |
| France/Italy/Portugal/Spain | LF/LI/LP/LE/GE | 090°–269° | FL195 | Respective AIPs |
| Spain (Canary Islands) | GC | 000°–179° | FL195 | ICAO standard (exception) |
| Australia | Y | 000°–179° | FL200 | CASA |
| New Zealand | NZ | 270°–089° | FL150 | CAA NZ |

### 3.4 Per-segment altitude selection

When a route includes a REA corridor, it is split into segments:

1. **Pre-corridor (free)**: semicircular rule based on the leg's magnetic course
2. **Corridor**: altitudes filtered by corridor constraints (altMin/altMax/altComp)
3. **Post-corridor (free)**: semicircular rule based on the leg's magnetic course

Segments shorter than 3 NM are absorbed into the adjacent corridor segment
(insufficient distance to reach cruise level).

When a corridor has a **compulsory altitude** (`altComp`), only that altitude is
offered — even if it doesn't match the semicircular +500 pattern (corridors
override the semicircular rule).

The ICAO Field 15 `cruiseLevel` uses the first segment's selected altitude for the
speed/level group. Altitude transitions are documented in Item 18 RMK/.

Code: `vfrNavigation.ts` — `segmentRouteLegs()`, `filterCorridorAltitudes()`.

---

## 4. IFR Semicircular Rule

| Magnetic Course | IFR Level |
|-----------------|-----------|
| 000° – 179° | Odd thousands (1 000, 3 000, 5 000…) |
| 180° – 359° | Even thousands (2 000, 4 000, 6 000…) |

Same region-specific direction splits as VFR. Maximum FL410.

Code: `vfrNavigation.ts` — `IFR_REGION_RULES`, `generateIfrAltitudes()`.

---

## 5. Cloud Clearance (VFR)

VFR flights must maintain **1 000 ft vertical separation** from BKN or OVC cloud layers.

- FEW (1–2 oktas) and SCT (3–4 oktas) are NOT ceiling layers.
- BKN (5–7 oktas) and OVC (8 oktas) constitute a ceiling.
- Altitudes above the lowest OVC layer are blocked entirely (no ground reference).

Source: ICAO Annex 2, §4.3; ICA 100-12, §3.8.

Code: `vfrNavigation.ts` — `filterAltitudesByCloudClearance()`.

---

## 6. VFR Weather Minimums & Flight Viability Validation

### 6.1 VMC Minimums

| Parameter | Minimum | Source |
|-----------|---------|--------|
| Ceiling (BKN/OVC) | >= 1 500 ft AGL | ICA 100-12, §3.2; ICAO Annex 2 |
| Visibility | >= 5 000 m (approx. 3.1 SM) | ICA 100-12, §3.2; ICAO Annex 2 |
| Night VFR ceiling | >= 1 500 ft AGL | ICA 100-12 |
| Night VFR visibility | >= 5 000 m | ICA 100-12 |
| VFR max altitude (Brazil) | FL145 (14 500 ft) | ICA 100-12, §4.6 |
| VFR max altitude (ICAO) | FL200 (20 000 ft) | ICAO Annex 2 |
| Cloud clearance (vertical) | 1 000 ft from BKN/OVC | ICAO Annex 2, §4.3; ICA 100-12, §3.8 |
| Pre-flight weather check | METAR + TAF for origin, destination, alternates | ICAO Annex 2, §2.3.2; RBAC 91.103 |

### 6.2 Time-Aware Weather Assessment

The app uses the planned departure time (EOBT) to determine which weather source
applies at each aerodrome:

| Aerodrome | Target time | Weather source logic |
|-----------|-------------|----------------------|
| Origin | EOBT (departure) | METAR if < 90 min old at target, else TAF period |
| Destination | EOBT + ETE | TAF period covering arrival time |
| Alternate | EOBT + ETE + alt flight time | TAF period covering alternate arrival |

When a METAR is used, the observation time is validated (< 90 min before target).
When TAF is used, the applicable period is selected via `findTafPeriodForTime()`.

### 6.3 Flight Viability Validation

The `validateVfrPlan()` function performs comprehensive validation across four severity levels:

| Severity | Color | Meaning | User action |
|----------|-------|---------|-------------|
| `blocking` | Red | Flight not viable — unmodifiable factor | Conditions must change externally |
| `actionable` | Orange | Not viable yet — user can fix | Shows what to fill/change |
| `warning` | Amber | Marginal or advisory | Pilot decision |
| `unverifiable` | Gray | Cannot validate — data unavailable | Must verify via external sources |

**Blocking rules (weather below VMC):**
- Origin ceiling < 1 500 ft at departure (ICA 100-12, §3.2)
- Origin visibility < 5 000 m at departure (ICA 100-12, §3.2)
- Destination ceiling < 1 500 ft at arrival (ICA 100-12, §3.2)
- Destination visibility < 5 000 m at arrival (ICA 100-12, §3.2)
- Origin or destination flight category IFR/LIFR at planned time

**Actionable rules (data completeness):**
- Origin/destination/aircraft not selected
- No route defined (total distance = 0)
- No cruise level selected
- Fuel insufficient (< trip + alternate + contingency + reserve per RBAC 91.151)
- Takeoff weight exceeds MTOW (RBAC 91.9)
- Cruise level above max VFR FL for region

**Warning rules:**
- Origin or destination MVFR at planned time
- Cloud clearance violation (altitude within 1 000 ft of BKN/OVC)

**Unverifiable (missing data):**
- METAR unavailable for origin/destination
- TAF unavailable and departure > 90 min away
- Planned time beyond TAF validity (usually 24–30h)

Code: `weatherTimeUtils.ts` — `validateVfrPlan()`, `getFlightCategoryForTime()`.
Replaces the former `vfrWeatherWarnings` useMemo.

---

## 7. Fuel Planning (RBAC 91.151 / ICA 100-12)

Minimum fuel = Trip + Alternate + Contingency + Reserve.

| Component | Calculation | Source |
|-----------|-------------|--------|
| Trip fuel | Consumption (kg/h) x trip time (origin -> destination) | RBAC 91.151 |
| Alternate fuel | Consumption (kg/h) x alt time (dest -> alternate) | RBAC 91.151 |
| Contingency | User-defined % of trip fuel (default 5%) | Operator policy |
| Reserve — Day | 30 min at cruise consumption | RBAC 91.151(a) |
| Reserve — Night | 45 min at cruise consumption | RBAC 91.151(b) |

Code: `VfrPlanForm.tsx` — fuel calculation block.

---

## 8. Ceiling Definition

Ceiling is defined as the height AGL of the **lowest BKN or OVC** cloud layer.

- FEW (1–2 oktas) and SCT (3–4 oktas) do NOT constitute a ceiling.
- BKN (5–7 oktas) and OVC (8 oktas) constitute a ceiling.

Source: ICAO Annex 3; WMO definitions; FAA AC 00-45H.

Code: `weather.service.ts` — `parseAvwxResponse()` ceiling filter.

---

## 9. Magnetic Declination

```
MC = TC - Declination  (positive = East, negative = West)
```

Declination is computed at the leg midpoint using the **World Magnetic Model 2025**
(via `geomagnetism` library).

Source: ICAO Doc 8168, Vol. I; WMM 2025 model coefficients.

Code: `vfrNavigation.ts` — `getMagneticDeclination()`, `calculateRouteLegs()`.

---

## 10. Top of Climb / Top of Descent

### 10.1 TOC (Top of Climb)

```
TOC (NM) = (Climb altitude / Climb rate) / 60 x Ground speed
```

Default climb rate: 700 fpm. Ground speed: from selected aircraft's cruise speed.
TOC is only computed when an aircraft is selected (requires performance data).

Code: `vfrNavigation.ts` — `calculateTocDistance()`.

### 10.2 TOD — VFR (Top of Descent)

Same formula as IFR 3:1 rule, computed automatically from altitude and destination elevation.
Displayed on map and in route legs table when aircraft is selected.

```
TOD (NM from destination) = (Cruise altitude - Destination elevation) / 1000 x 3
```

### 10.3 TOD — IFR (3:1 rule)

Standard 3-degree descent path. Source: ICAO Doc 8168 PANS-OPS Vol. I.

```
TOD (NM from destination) = (Cruise altitude - Destination elevation) / 1000 x 3
```

Code: `vfrNavigation.ts` — `calculateTodDistance()`, `calculateTodFromDestination()`.

---

## 11. Performance Category (ICAO Doc 8168)

Approach category based on approach speed (Vat = 1.3 x Vs0):

| Category | Vat range (kts) | Approximation |
|----------|-----------------|---------------|
| A | < 91 | Vat approx. 65% of cruise speed |
| B | 91–120 | |
| C | 121–140 | |
| D | 141–165 | |
| E | > 165 | |

Goes into Item 18 as `PER/A` through `PER/E`.

Code: `vfrNavigation.ts` — `getPerformanceCategory()`.

---

## 12. Route Segment Logic

When a corridor is followed, the route is segmented for altitude selection:

| Segment | Type | Altitude rule |
|---------|------|---------------|
| Origin -> corridor entry | Free | Semicircular rule per MC |
| Corridor entry -> corridor exit | Corridor | Corridor constraints (altMin/altMax/altComp) |
| Corridor exit -> destination | Free | Semicircular rule per MC |

- Segments shorter than 3 NM are absorbed into the adjacent corridor segment.
- Each segment has independent altitude selection.
- The weighted average MC for each segment determines its semicircular direction.
- Corridor compulsory altitude overrides all other rules for that segment.

Code: `vfrNavigation.ts` — `segmentRouteLegs()`.

---

## 13. Weighted Average Magnetic Course

The average MC for a multi-leg segment uses **distance-weighted circular averaging**
(sin/cos decomposition) to correctly handle the 0°/360° wraparound:

```
avgMC = atan2(sum(sin(MC_i) * dist_i), sum(cos(MC_i) * dist_i))
```

This prevents the naive arithmetic mean from producing incorrect results near North
(e.g., averaging 350° and 010° should yield 000°, not 180°).

Code: `vfrNavigation.ts` — `weightedAverageMC()`, `suggestCruiseLevel()`.

---

## Decision Log

| Date | Decision | Rationale | Source verified |
|------|----------|-----------|-----------------|
| 2026-05-14 | `FL` prefix instead of bare `F` for flight levels | DECEA/Brazilian practice; universally understood | ICAO Doc 4444 §2.3, DECEA forms |
| 2026-05-14 | DCT between all coordinates (DECEA practice) | ICAO allows omission between coords, but DECEA examples always include DCT | NexAtlas REA article, DECEA MCA 100-11 |
| 2026-05-14 | REA identifier in Item 18 only, NOT in Field 15 | Field 15 contains only coordinates/DCT; corridor name goes in RMK/ | DECEA MCA 100-11, NexAtlas |
| 2026-05-14 | Corridor compulsory altitude overrides semicircular rule | Corridor constraints take precedence; `filterCorridorAltitudes` returns `[compAlt]` directly | REA chart publications |
| 2026-05-14 | TOC/TOD only computed with aircraft selected | Requires cruise speed and climb rate from aircraft data | Physical dependency |
| 2026-05-14 | Altitude transitions in RMK/ use actual user selections | Previous version used first suggested altitude; now reads from `segmentLevels` state | ICAO Doc 4444 §18 accuracy requirement |
| 2026-05-14 | Time-aware weather assessment using planned departure | METAR is validated for age (<90min); TAF period used when METAR stale or departure is future | ICAO Annex 2 §2.3.2, RBAC 91.103 |
| 2026-05-14 | Flight viability validation replaces simple weather warning | Comprehensive check of weather, fuel, weight, data completeness with severity levels | ICA 100-12, RBAC 91.151, RBAC 91.9, ICAO Annex 2 |

---

## Sources (complete list)

- **ICAO Doc 4444** (PANS-ATM) — Flight plan form fields, route field format
- **ICAO Annex 2** — Rules of the Air, semicircular table, VFR weather minimums
- **ICAO Annex 3** — Meteorological definitions (ceiling)
- **ICAO Doc 8168** (PANS-OPS) — Descent/approach procedures, performance categories
- **DECEA ICA 100-12** — Regras do Ar e Servicos de Trafego Aereo (Brazilian)
- **DECEA MCA 100-11** — Preenchimento de Planos de Voo (Brazilian)
- **DECEA AIC-N-20/21** — Circulacao VFR Integrada TMA-SP/TMA-RJ
- **RBAC 91.9** — Aircraft flight manual limitations (MTOW compliance)
- **RBAC 91.103** — Pre-flight action (weather check requirement)
- **RBAC 91.151** — Fuel requirements for VFR flights (Brazilian/ANAC)
- **FAA FAR 91.159** — VFR cruising altitudes (USA)
- **WMM 2025** — World Magnetic Model (magnetic declination)
- **NexAtlas** — "REA e REH: Voando em corredores visuais" (practical DECEA examples)
