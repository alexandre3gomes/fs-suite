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
