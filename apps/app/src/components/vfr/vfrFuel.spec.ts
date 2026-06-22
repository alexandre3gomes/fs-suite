import { describe, expect, it } from 'vitest';

import { AVGAS_KG_PER_L, computeFuelPlan, formatEndurance, type FuelPlanInput } from './vfrFuel';

// A computable baseline: 30 kg/h burn, 120 kt cruise, 120 NM trip (= 1.0 h),
// 60 NM to the alternate (= 0.5 h). Weights chosen to stay under MTOW.
function baseInput(overrides: Partial<FuelPlanInput> = {}): FuelPlanInput {
  return {
    consumptionKgH: 30,
    cruiseKts: 120,
    totalDistanceNm: 120,
    enrichedLegsTimeMin: null,
    altDistNm: 60,
    contingencyPct: 10,
    reserveMinutes: 30,
    fuelOnBoardKg: 90,
    fuelCapacityL: 100,
    emptyWeightKg: 700,
    mtowKg: 1111,
    payloadKg: 200,
    ...overrides,
  };
}

describe('computeFuelPlan — trip and alternate fuel', () => {
  it('derives trip fuel from distance / cruise speed when no enriched legs', () => {
    const p = computeFuelPlan(baseInput());
    expect(p.canComputeFuel).toBe(true);
    expect(p.tripHours).toBeCloseTo(1, 6);
    expect(p.tripMinutes).toBe(60);
    expect(p.tripFuelKg).toBeCloseTo(30, 6);
    expect(p.altHours).toBeCloseTo(0.5, 6);
    expect(p.altFuelKg).toBeCloseTo(15, 6);
  });

  it('prefers wind-corrected enriched leg time over distance', () => {
    const p = computeFuelPlan(baseInput({ enrichedLegsTimeMin: 90 }));
    expect(p.tripHours).toBeCloseTo(1.5, 6);
    expect(p.tripMinutes).toBe(90);
    expect(p.tripFuelKg).toBeCloseTo(45, 6);
  });

  it('reports not computable and zero fuel when consumption is zero', () => {
    const p = computeFuelPlan(baseInput({ consumptionKgH: 0 }));
    expect(p.canComputeFuel).toBe(false);
    expect(p.tripFuelKg).toBe(0);
    expect(p.reserveFuelKg).toBe(0);
    expect(p.minFuelKg).toBe(0);
  });

  it('reports not computable when cruise speed is unknown', () => {
    const p = computeFuelPlan(baseInput({ cruiseKts: null }));
    expect(p.canComputeFuel).toBe(false);
    expect(p.tripFuelKg).toBe(0);
  });

  it('contributes no alternate fuel when there is no alternate', () => {
    const p = computeFuelPlan(baseInput({ altDistNm: 0 }));
    expect(p.altHours).toBe(0);
    expect(p.altFuelKg).toBe(0);
  });
});

describe('computeFuelPlan — contingency, reserve and required total', () => {
  it('applies a 10% contingency on trip fuel', () => {
    const p = computeFuelPlan(baseInput({ contingencyPct: 10 }));
    expect(p.contingencyFactor).toBeCloseTo(0.1, 6);
    expect(p.contingencyFuelKg).toBeCloseTo(3, 6); // 10% of 30
  });

  it('uses a 30-minute reserve for day flights', () => {
    const p = computeFuelPlan(baseInput({ reserveMinutes: 30 }));
    expect(p.reserveFuelKg).toBeCloseTo(15, 6); // 30 kg/h * 0.5 h
  });

  it('uses a 45-minute reserve for night flights', () => {
    const p = computeFuelPlan(baseInput({ reserveMinutes: 45 }));
    expect(p.reserveFuelKg).toBeCloseTo(22.5, 6); // 30 kg/h * 0.75 h
  });

  it('sums trip + alternate + contingency + reserve into the required total', () => {
    const p = computeFuelPlan(baseInput());
    // 30 (trip) + 15 (alt) + 3 (contingency) + 15 (reserve) = 63
    expect(p.minFuelKg).toBeCloseTo(63, 6);
  });
});

describe('computeFuelPlan — capacity, per-wing and weight', () => {
  it('converts usable capacity from litres to kg', () => {
    const p = computeFuelPlan(baseInput({ fuelCapacityL: 100 }));
    expect(p.maxFuelKg).toBeCloseTo(100 * AVGAS_KG_PER_L, 6);
  });

  it('returns null capacity when the aircraft has no known capacity', () => {
    const p = computeFuelPlan(baseInput({ fuelCapacityL: null }));
    expect(p.maxFuelKg).toBeNull();
  });

  it('splits fuel on board evenly per wing', () => {
    const p = computeFuelPlan(baseInput({ fuelOnBoardKg: 90 }));
    expect(p.perWingKg).toBeCloseTo(45, 6);
  });

  it('computes takeoff weight and reports no MTOW excess when within limits', () => {
    const p = computeFuelPlan(baseInput({ emptyWeightKg: 700, payloadKg: 200, fuelOnBoardKg: 90 }));
    expect(p.canComputeWeight).toBe(true);
    expect(p.takeoffWeightKg).toBeCloseTo(990, 6);
    expect(p.mtowExcessKg).toBe(0);
  });

  it('reports the overweight amount when above MTOW', () => {
    const p = computeFuelPlan(baseInput({ emptyWeightKg: 900, payloadKg: 300, fuelOnBoardKg: 100, mtowKg: 1111 }));
    expect(p.takeoffWeightKg).toBeCloseTo(1300, 6);
    expect(p.mtowExcessKg).toBeCloseTo(189, 6);
  });

  it('cannot compute weight without empty weight and MTOW', () => {
    const p = computeFuelPlan(baseInput({ emptyWeightKg: null }));
    expect(p.canComputeWeight).toBe(false);
    expect(p.takeoffWeightKg).toBeNull();
    expect(p.mtowExcessKg).toBeNull();
  });
});

describe('computeFuelPlan — endurance', () => {
  it('computes whole-minute endurance for the fuel on board', () => {
    const p = computeFuelPlan(baseInput({ fuelOnBoardKg: 90, consumptionKgH: 30 }));
    expect(p.enduranceMin).toBe(180); // 90 / 30 * 60
  });

  it('floors fractional endurance minutes', () => {
    const p = computeFuelPlan(baseInput({ fuelOnBoardKg: 50, consumptionKgH: 30 }));
    expect(p.enduranceMin).toBe(100); // 50/30*60 = 100.0
  });
});

describe('formatEndurance', () => {
  it('splits minutes into hours and zero-padded remainder', () => {
    expect(formatEndurance(180)).toEqual({ hours: 3, minutes: 0, label: '3h00min', hhmm: '03:00' });
  });

  it('formats a non-round duration', () => {
    expect(formatEndurance(150)).toEqual({ hours: 2, minutes: 30, label: '2h30min', hhmm: '02:30' });
  });

  it('formats single-digit minutes with padding', () => {
    expect(formatEndurance(125)).toEqual({ hours: 2, minutes: 5, label: '2h05min', hhmm: '02:05' });
  });

  it('treats zero, negative and non-finite as zero', () => {
    expect(formatEndurance(0)).toEqual({ hours: 0, minutes: 0, label: '0h00min', hhmm: '00:00' });
    expect(formatEndurance(-5)).toEqual({ hours: 0, minutes: 0, label: '0h00min', hhmm: '00:00' });
    expect(formatEndurance(Number.NaN)).toEqual({ hours: 0, minutes: 0, label: '0h00min', hhmm: '00:00' });
  });
});
