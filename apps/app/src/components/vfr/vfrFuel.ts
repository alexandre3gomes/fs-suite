// Pure fuel / weight / endurance calculations for VFR planning.
//
// Extracted from VfrPlanForm.tsx to keep the form component lean and to make the
// operationally important math unit-testable in isolation. Everything here is a
// pure function of its inputs — no React, no I/O, no unit-store coupling. The
// component is responsible for converting user input (which may be in kg, lbs,
// L or gal) into the canonical kg / kg-per-hour values these functions expect.

/** Density used to convert AVGAS volume (litres) to mass (kg). */
export const AVGAS_KG_PER_L = 0.72;

export interface FuelPlanInput {
  /** Fuel flow, kg per hour. <= 0 means "not computable". */
  consumptionKgH: number;
  /** Cruise true airspeed in knots, or null when unknown. */
  cruiseKts: number | null;
  /** Total route distance in nautical miles. */
  totalDistanceNm: number;
  /**
   * Sum of wind-corrected leg times (minutes) when an enriched route is
   * available; null to fall back to distance / cruise speed.
   */
  enrichedLegsTimeMin: number | null;
  /** Distance destination -> alternate in nautical miles (0 when no alternate). */
  altDistNm: number;
  /** Contingency as a percentage value (e.g. 5 means 5%). */
  contingencyPct: number;
  /** Reserve requirement in minutes (e.g. 30 day / 45 night). */
  reserveMinutes: number;
  /** Fuel actually on board, kg. */
  fuelOnBoardKg: number;
  /** Aircraft usable fuel capacity in litres, or null when unknown. */
  fuelCapacityL: number | null;
  /** Aircraft empty weight in kg, or null when unknown. */
  emptyWeightKg: number | null;
  /** Aircraft MTOW in kg, or null when unknown. */
  mtowKg: number | null;
  /** Payload (pax + cargo) in kg. */
  payloadKg: number;
}

export interface FuelPlan {
  /** True when cruise speed and consumption are both known. */
  canComputeFuel: boolean;
  tripHours: number;
  tripMinutes: number;
  tripFuelKg: number;
  altHours: number;
  altFuelKg: number;
  /** Contingency fraction (e.g. 0.05). */
  contingencyFactor: number;
  contingencyFuelKg: number;
  reserveFuelKg: number;
  /** Minimum required fuel: trip + alternate + contingency + reserve. */
  minFuelKg: number;
  /** Usable capacity in kg, or null when capacity is unknown. */
  maxFuelKg: number | null;
  /** True when empty weight and MTOW are both known. */
  canComputeWeight: boolean;
  takeoffWeightKg: number | null;
  /** Amount over MTOW in kg (0 when within limits), or null when not computable. */
  mtowExcessKg: number | null;
  /** Fuel per wing, kg (assumes symmetric two-tank layout). */
  perWingKg: number;
  /** Endurance in whole minutes for the fuel on board at current consumption. */
  enduranceMin: number;
}

/**
 * Compute the VFR fuel and weight plan. Behaviour mirrors the original inline
 * derivation in VfrPlanForm exactly, so it is safe to swap in place.
 */
export function computeFuelPlan(input: FuelPlanInput): FuelPlan {
  const {
    consumptionKgH,
    cruiseKts,
    totalDistanceNm,
    enrichedLegsTimeMin,
    altDistNm,
    contingencyPct,
    reserveMinutes,
    fuelOnBoardKg,
    fuelCapacityL,
    emptyWeightKg,
    mtowKg,
    payloadKg,
  } = input;

  const canComputeFuel = cruiseKts != null && cruiseKts > 0 && consumptionKgH > 0;

  const tripHours = enrichedLegsTimeMin != null
    ? enrichedLegsTimeMin / 60
    : canComputeFuel && totalDistanceNm > 0
      ? totalDistanceNm / cruiseKts!
      : 0;
  const tripFuelKg = canComputeFuel && tripHours > 0 ? consumptionKgH * tripHours : 0;

  const altHours = canComputeFuel && altDistNm > 0 ? altDistNm / cruiseKts! : 0;
  const altFuelKg = canComputeFuel && altHours > 0 ? consumptionKgH * altHours : 0;

  const contingencyFactor = (contingencyPct || 0) / 100;
  const contingencyFuelKg = tripFuelKg * contingencyFactor;
  const reserveFuelKg = consumptionKgH > 0 ? consumptionKgH * (reserveMinutes / 60) : 0;
  const minFuelKg = tripFuelKg + altFuelKg + contingencyFuelKg + reserveFuelKg;

  const maxFuelKg = fuelCapacityL != null ? fuelCapacityL * AVGAS_KG_PER_L : null;

  const canComputeWeight = emptyWeightKg != null && mtowKg != null;
  const takeoffWeightKg = canComputeWeight
    ? emptyWeightKg! + payloadKg + fuelOnBoardKg
    : null;
  const mtowExcessKg = canComputeWeight && takeoffWeightKg != null
    ? Math.max(0, takeoffWeightKg - mtowKg!)
    : null;

  const perWingKg = fuelOnBoardKg > 0 ? fuelOnBoardKg / 2 : 0;
  const enduranceMin = consumptionKgH > 0 ? Math.floor((fuelOnBoardKg / consumptionKgH) * 60) : 0;
  const tripMinutes = Math.round(tripHours * 60);

  return {
    canComputeFuel,
    tripHours,
    tripMinutes,
    tripFuelKg,
    altHours,
    altFuelKg,
    contingencyFactor,
    contingencyFuelKg,
    reserveFuelKg,
    minFuelKg,
    maxFuelKg,
    canComputeWeight,
    takeoffWeightKg,
    mtowExcessKg,
    perWingKg,
    enduranceMin,
  };
}

export interface Endurance {
  /** Whole hours. */
  hours: number;
  /** Remaining minutes after whole hours (0–59). */
  minutes: number;
  /** Compact "2h05min" form used in the planning UI. */
  label: string;
  /** Zero-padded "HH:MM" form. */
  hhmm: string;
}

/**
 * Split a duration in whole minutes into hours/minutes and pre-formatted
 * strings. Negative or non-finite input is treated as zero.
 */
export function formatEndurance(totalMin: number): Endurance {
  const safe = Number.isFinite(totalMin) && totalMin > 0 ? Math.floor(totalMin) : 0;
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  const mm = String(minutes).padStart(2, '0');
  return {
    hours,
    minutes,
    label: `${hours}h${mm}min`,
    hhmm: `${String(hours).padStart(2, '0')}:${mm}`,
  };
}
