export enum FlightRules {
  VFR = 'VFR',
  IFR = 'IFR',
  VFR_IFR = 'VFR_IFR',
  IFR_VFR = 'IFR_VFR',
}

export enum PlanStatus {
  DRAFT = 'DRAFT',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
}

export enum OAuthProvider {
  GOOGLE = 'google',
}

// ICAO Doc 4444 — Wake Turbulence Category (Item 9)
export enum WakeTurbulenceCategory {
  L = 'L', // MTOW < 7 000 kg
  M = 'M', // 7 000 kg ≤ MTOW < 136 000 kg
  H = 'H', // 136 000 kg ≤ MTOW < 560 000 kg
  J = 'J', // MTOW ≥ 560 000 kg (A380-class)
}

// ICAO Doc 4444 — Type of Flight (Item 8b)
export enum TypeOfFlight {
  S = 'S', // Scheduled air service
  N = 'N', // Non-scheduled air transport
  G = 'G', // General aviation
  M = 'M', // Military
  X = 'X', // Other
}

// ---------------------------------------------------------------------------
// VFR published-layer model (worldwide). REA/REH/WAC are Brazilian
// specializations; US/EU/local types are reserved for future regions.
// See docs/vfr-layer-model.md.
// ---------------------------------------------------------------------------

export enum VfrLayerType {
  // Brazil (DECEA) specializations
  BR_REA = 'BR_REA', // Rede de Espera / rotas especiais VFR (corredores)
  BR_REH = 'BR_REH', // Rotas Especiais de Helicóptero (reserved — not served yet)
  BR_WAC = 'BR_WAC', // World Aeronautical Chart tiles (regional, Brazil)
  // United States (FAA NASR for vector; raster charts are external links only)
  US_AIRSPACE = 'US_AIRSPACE',
  US_AIRPORTS = 'US_AIRPORTS',
  US_NAVAIDS = 'US_NAVAIDS',
  US_REPORTING_POINTS = 'US_REPORTING_POINTS',
  US_VFR_FLYWAY = 'US_VFR_FLYWAY',
  US_VFR_TRANSITION_ROUTE = 'US_VFR_TRANSITION_ROUTE',
  // Europe (EUROCONTROL / national AIPs / OpenAIP community) — reserved for future
  EU_AIRSPACE = 'EU_AIRSPACE',
  EU_VRP = 'EU_VRP',
  EU_VFR_TRANSIT_ROUTE = 'EU_VFR_TRANSIT_ROUTE',
  // Generic fallback (e.g. community/local visual routes)
  LOCAL_VISUAL_ROUTE = 'LOCAL_VISUAL_ROUTE',
}

export enum VfrLayerGeometryType {
  VECTOR_GEOJSON = 'VECTOR_GEOJSON',
  RASTER_WMS = 'RASTER_WMS',
  RASTER_TILE = 'RASTER_TILE',
  PDF_OVERLAY = 'PDF_OVERLAY',
  EXTERNAL_LINK = 'EXTERNAL_LINK', // official raster chart reached via external link (not hosted)
}

export enum VfrLayerProvider {
  DECEA_GEOAISWEB = 'DECEA_GEOAISWEB',
  FAA_NASR = 'FAA_NASR',
  FAA_VFR_RASTER = 'FAA_VFR_RASTER',
  EUROCONTROL_EAD = 'EUROCONTROL_EAD',
  NATIONAL_AIP = 'NATIONAL_AIP',
  OPENAIP = 'OPENAIP', // community / non-official
  LOCAL = 'LOCAL',
}
