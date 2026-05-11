# VFR Regulatory References

Rules applied in the VFR flight planning module with their authoritative sources.
Each rule cites the regulation that governs it so deviations can be traced.

---

## 1. Route Text — Item 15 (ICAO Doc 4444 Appendix 2)

### 1.1 Overall structure

```
[Cruising Speed][Cruising Level] [Route Description]
```

| Element | Format | Example | Source |
|---------|--------|---------|--------|
| Speed (knots) | `N` + 4 digits | `N0110` | ICAO Doc 4444 §2.3 |
| Level — altitude | `A` + 3 digits (hundreds of feet) | `A045` | ICAO Doc 4444 §2.3 |
| Level — flight level | `F` + 3 digits | `F085` | ICAO Doc 4444 §2.3 |
| Level — VFR (uncontrolled) | literal `VFR` | `VFR` | ICAO Doc 4444 §2.3 |

### 1.2 Coordinate format (degrees and minutes, 11 chars)

```
ddmmN/SdddmmE/W
```

Example: `2312S05047W` = 23°12′S 050°47′W

Source: ICAO Doc 4444 Appendix 2, item (c).

### 1.3 DCT usage

- `DCT` is **required** between named designators and between a designator and a coordinate.
- `DCT` **may be omitted** between two successive geographic coordinates (ICAO Doc 4444 §5.1 exception).
- Implementation: we omit DCT between consecutive coordinates.

### 1.4 Standard VFR route example

```
SBSP DCT 2338S04640W 2345S04655W DCT SBGR
```

### 1.5 REA corridor route (DECEA-specific)

Two accepted formats per DECEA publications:

| Option | Item 15 | Item 18 | Source |
|--------|---------|---------|--------|
| A — Simplified | `REA` | `REA GOLF` | DECEA AIC-N-20/21; Canal Piloto |
| B — Detailed | All corridor coordinates with `DCT` | `REA GOLF` | MCA 100-11 |

Implementation uses a hybrid that marks the entry/exit:

```
Item 15: SBSP DCT 2312S05047W REA 2306S05021W DCT SBGR
Item 18: REA GOLF
```

Sources:
- DECEA MCA 100-11 (Preenchimento de Planos de Voo)
- DECEA AIC-N-20/21 (Circulação VFR Integrada TMA-SP/TMA-RJ)
- NexAtlas — REA e REH: Voando em corredores visuais

---

## 2. Remarks — Item 18 (ICAO Doc 4444 Appendix 2)

Auto-generated fields:

| Field | Format | When | Source |
|-------|--------|------|--------|
| `DOF/` | `DOF/YYMMDD` | Always (date of flight) | ICAO Doc 4444 §18 |
| `REA [name]` | `REA GOLF` | Following a REA corridor | MCA 100-11 / AIC-N-20/21 |
| `RMK/` | Free text | User-entered remarks | ICAO Doc 4444 §18 |

---

## 3. VFR Semicircular Rule (Cruise Altitude)

### 3.1 ICAO standard (Annex 2, Table S3-1)

| Magnetic Course | VFR Level |
|----------------|-----------|
| 000° – 179° | Odd thousands + 500 ft (3500, 5500, 7500…) |
| 180° – 359° | Even thousands + 500 ft (4500, 6500, 8500…) |

### 3.2 Brazil (ICA 100-12, §4.6)

Same direction split as ICAO, **maximum VFR level FL145** (14 500 ft).

### 3.3 IMC altitudes (ICA 100-12)

When ceiling is BKN/OVC and conditions are IFR/LIFR, altitudes switch to full thousands (no +500 offset).

### 3.4 Region-specific rules

| Region | Odd range | Max VFR FL | Source |
|--------|-----------|------------|--------|
| Brazil (SB/SD/SI/SJ/SN/SS/SW) | 000°–179° | FL145 | ICA 100-12 |
| ICAO default | 000°–179° | FL195 | ICAO Annex 2 |
| USA/Canada (K/C prefixes) | 000°–179° | FL175 | FAA FAR 91.159 |
| France/Italy/Portugal/Spain | 090°–269° | FL195 | Respective AIPs |
| Australia (Y prefix) | 000°–179° | FL200 | CASA |
| New Zealand (NZ prefix) | 270°–089° | FL150 | CAA NZ |

Code: `vfrNavigation.ts` — `REGION_RULES`, `generateAltitudes()`.

---

## 4. Cloud Clearance (VFR)

VFR flights must maintain **1 000 ft vertical separation** from BKN or OVC cloud layers.

- FEW and SCT are NOT ceiling layers (ICAO definition: ceiling = lowest BKN or OVC).
- Altitudes above the lowest OVC layer are blocked (no ground visibility).

Source: ICAO Annex 2, §4.3; ICA 100-12, §3.8.

Code: `vfrNavigation.ts` — `filterAltitudesByCloudClearance()`.

---

## 5. VFR Weather Minimums

| Parameter | Minimum | Source |
|-----------|---------|--------|
| Ceiling (BKN/OVC) | ≥ 1 500 ft AGL | ICA 100-12, §3.2 |
| Visibility | ≥ 5 000 m (≈ 3.1 SM) | ICA 100-12, §3.2; ICAO Annex 2 |

When conditions are MVFR, IFR, or LIFR (from aviationweather.gov `fltCat`), the app warns the user that VFR minimums are not met.

Code: `VfrPlanForm.tsx` — `vfrWeatherWarnings`.

---

## 6. Fuel Planning (RBAC 91.151 / ICA 100-12)

Minimum fuel = Trip + Alternate + Contingency + Reserve.

| Component | Calculation | Source |
|-----------|-------------|--------|
| Trip fuel | Consumption × trip time (origin → destination) | RBAC 91.151 |
| Alternate fuel | Consumption × alt time (dest → alternate) | RBAC 91.151 |
| Contingency | User-defined % of trip fuel (default 5%) | Operator policy |
| Reserve — Day | 30 min at cruise consumption | RBAC 91.151(a) |
| Reserve — Night | 45 min at cruise consumption | RBAC 91.151(b) |

Code: `VfrPlanForm.tsx` — fuel calculation block.

---

## 7. Ceiling Definition

Ceiling is defined as the height above ground (AGL) of the **lowest Broken (BKN) or Overcast (OVC)** cloud layer.

- FEW (1-2 oktas) and SCT (3-4 oktas) do NOT constitute a ceiling.
- BKN (5-7 oktas) and OVC (8 oktas) constitute a ceiling.

Source: ICAO Annex 3 (Meteorological Service for International Air Navigation); WMO definitions; FAA AC 00-45H.

Code: `weather.service.ts` — `parseAvwxResponse()` ceiling filter.

---

## 8. Magnetic Declination

True Course is converted to Magnetic Course by subtracting the declination:

```
MC = TC − Declination (positive East, negative West)
```

Declination is computed at the leg midpoint using the World Magnetic Model 2025 (via `geomagnetism` library).

Source: ICAO Doc 8168, Vol. I; WMM 2025 model coefficients.

Code: `vfrNavigation.ts` — `getMagneticDeclination()`, `calculateRouteLegs()`.

---

## 9. IFR Top of Descent (3:1 Rule)

```
TOD (NM) = (Cruise Altitude − Destination Elevation) / 1000 × 3
```

Standard 3° descent path. Source: ICAO Doc 8168 PANS-OPS Vol. I.

Code: `vfrNavigation.ts` — `calculateTodDistance()`.

---

## Sources (full list)

- **ICAO Doc 4444** (PANS-ATM) — Flight plan form fields, route field format
- **ICAO Annex 2** — Rules of the Air, semicircular table, VFR weather minimums
- **ICAO Annex 3** — Meteorological definitions (ceiling)
- **ICAO Doc 8168** (PANS-OPS) — Descent procedures
- **DECEA ICA 100-12** — Regras do Ar e Serviços de Tráfego Aéreo (Brazilian)
- **DECEA MCA 100-11** — Preenchimento de Planos de Voo (Brazilian)
- **DECEA AIC-N-20/21** — Circulação VFR Integrada TMA-SP/TMA-RJ
- **RBAC 91.151** — Fuel requirements for VFR flights (Brazilian/ANAC)
- **FAA FAR 91.159** — VFR cruising altitudes (USA)
- **WMM 2025** — World Magnetic Model (magnetic declination)
