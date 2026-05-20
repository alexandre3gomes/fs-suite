import { computeDataCompleteness } from '@fs-suite/types';
import { describe, expect, it } from 'vitest';

import type { ValidateVfrPlanParams } from './weatherTimeUtils';
import { formatOptionalMetric, validateVfrPlan } from './weatherTimeUtils';

// --------------- Helpers ---------------

function baseParams(overrides: Partial<ValidateVfrPlanParams> = {}): ValidateVfrPlanParams {
  const now = new Date();
  return {
    departureTime: now,
    origin: { icao: 'SBSP' },
    destination: { icao: 'SBGR' },
    alternate: null,
    aircraft: { cruiseSpeedKts: 120, mtowKg: 1111 },
    cruiseLevel: 'FL045',
    totalDistanceNm: 50,
    fuelOnBoardKg: 100,
    minFuelKg: 60,
    takeoffWeightKg: 1000,
    mtowKg: 1111,
    flightCondition: 'day',
    enduranceMin: 180,
    icaoPrefix: 'SB',
    ...overrides,
  };
}

// --------------- Weight viability ---------------

describe('validateVfrPlan — weight checks', () => {
  it('returns unverifiable when takeoffWeightKg is null', () => {
    const result = validateVfrPlan(baseParams({ takeoffWeightKg: null }));
    const item = result.items.find((i) => i.id === 'weight-unverifiable');
    expect(item).toBeDefined();
    expect(item!.severity).toBe('unverifiable');
  });

  it('returns unverifiable when mtowKg is null', () => {
    const result = validateVfrPlan(baseParams({ mtowKg: null }));
    const item = result.items.find((i) => i.id === 'weight-unverifiable');
    expect(item).toBeDefined();
    expect(item!.severity).toBe('unverifiable');
  });

  it('returns unverifiable when both weight fields are null', () => {
    const result = validateVfrPlan(baseParams({ takeoffWeightKg: null, mtowKg: null }));
    const item = result.items.find((i) => i.id === 'weight-unverifiable');
    expect(item).toBeDefined();
  });

  it('does NOT return unverifiable when weight data is present', () => {
    const result = validateVfrPlan(baseParams({ takeoffWeightKg: 1000, mtowKg: 1111 }));
    const item = result.items.find((i) => i.id === 'weight-unverifiable');
    expect(item).toBeUndefined();
  });

  it('returns actionable when takeoff weight exceeds MTOW', () => {
    const result = validateVfrPlan(baseParams({ takeoffWeightKg: 1200, mtowKg: 1111 }));
    const item = result.items.find((i) => i.id === 'weight-over-mtow');
    expect(item).toBeDefined();
    expect(item!.severity).toBe('actionable');
  });

  it('does NOT flag weight when within limits', () => {
    const result = validateVfrPlan(baseParams({ takeoffWeightKg: 1000, mtowKg: 1111 }));
    expect(result.items.find((i) => i.id === 'weight-over-mtow')).toBeUndefined();
    expect(result.items.find((i) => i.id === 'weight-unverifiable')).toBeUndefined();
  });

  it('overall status is unverifiable when only weight is unknown', () => {
    const result = validateVfrPlan(baseParams({ takeoffWeightKg: null, mtowKg: null }));
    expect(result.status).toBe('unverifiable');
  });
});

// --------------- Data completeness ---------------

describe('computeDataCompleteness', () => {
  it('skeleton when no core fields', () => {
    expect(computeDataCompleteness({})).toBe('skeleton');
  });

  it('partial when some performance fields present', () => {
    expect(computeDataCompleteness({ mtowKg: 1111, cruiseSpeedKts: 120 })).toBe('partial');
  });

  it('partial when all performance present but no stations', () => {
    expect(
      computeDataCompleteness({
        emptyWeightKg: 767,
        mtowKg: 1111,
        fuelCapacityL: 212,
        fuelBurnLph: 34,
        cruiseSpeedKts: 124,
        stations: null,
      }),
    ).toBe('partial');
  });

  it('complete when all core fields and stations present', () => {
    expect(
      computeDataCompleteness({
        emptyWeightKg: 767,
        mtowKg: 1111,
        fuelCapacityL: 212,
        fuelBurnLph: 34,
        cruiseSpeedKts: 124,
        stations: [{ id: 'pilot', labelKey: 'pilot', defaultKg: 80, maxKg: 120, arm: 0.94 }],
      }),
    ).toBe('complete');
  });
});

// --------------- Display formatting ---------------

describe('formatOptionalMetric', () => {
  it('returns N/D for null', () => {
    expect(formatOptionalMetric(null, 'kg')).toBe('N/D');
  });

  it('returns N/D for undefined', () => {
    expect(formatOptionalMetric(undefined, 'kt')).toBe('N/D');
  });

  it('formats number with unit', () => {
    expect(formatOptionalMetric(120, 'kt')).toBe('120 kt');
  });

  it('formats zero with unit', () => {
    expect(formatOptionalMetric(0, 'kg')).toBe('0 kg');
  });
});
