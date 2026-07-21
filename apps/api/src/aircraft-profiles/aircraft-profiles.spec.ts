import {
  computeDataCompleteness,
  hasWeightData,
  hasPerformanceData,
  hasStationData,
  AircraftCatalogEntrySchema,
  UserAircraftProfileSchema,
  CreateAircraftProfileSchema,
  UpdateAircraftProfileSchema,
  DataCompleteness,
  type AircraftCatalogEntry,
} from '@fs-suite/types';
import { BadRequestException } from '@nestjs/common';
import { describe, it, expect } from 'vitest';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

import type { AircraftProfileWithStations } from './aircraft-profiles.service';
import { baseFields, toCatalogEntry, toUserProfile } from './aircraft-profiles.service';

describe('computeDataCompleteness', () => {
  it('returns skeleton when no core fields present', () => {
    expect(computeDataCompleteness({})).toBe('skeleton');
    expect(
      computeDataCompleteness({
        emptyWeightKg: null,
        mtowKg: null,
        fuelCapacityL: null,
        fuelBurnLph: null,
        cruiseSpeedKts: null,
        stations: null,
      }),
    ).toBe('skeleton');
  });

  it('returns partial when some fields present', () => {
    expect(
      computeDataCompleteness({
        mtowKg: 1111,
        cruiseSpeedKts: 124,
      }),
    ).toBe('partial');
  });

  it('returns partial when all performance fields present but no stations', () => {
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

  it('returns partial when all performance fields present but empty stations', () => {
    expect(
      computeDataCompleteness({
        emptyWeightKg: 767,
        mtowKg: 1111,
        fuelCapacityL: 212,
        fuelBurnLph: 34,
        cruiseSpeedKts: 124,
        stations: [],
      }),
    ).toBe('partial');
  });

  it('returns complete when all core fields and stations present', () => {
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

describe('helper predicates', () => {
  const skeleton: AircraftCatalogEntry = {
    id: 'test-1',
    name: 'Test Aircraft',
    icaoType: 'TEST',
    manufacturer: null,
    model: null,
    emptyWeightKg: null,
    mtowKg: null,
    fuelCapacityL: null,
    fuelBurnLph: null,
    cruiseSpeedKts: null,
    climbSpeedKts: null,
    climbRateFpm: null,
    descentSpeedKts: null,
    descentRateFpm: null,
    stations: null,
    source: 'simbrief',
    dataCompleteness: DataCompleteness.SKELETON,
    isTemplate: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const complete: AircraftCatalogEntry = {
    ...skeleton,
    emptyWeightKg: 767,
    mtowKg: 1111,
    fuelCapacityL: 212,
    fuelBurnLph: 34,
    cruiseSpeedKts: 124,
    stations: [{ id: 'pilot', labelKey: 'pilot', defaultKg: 80, maxKg: 120, arm: 0.94 }],
    dataCompleteness: DataCompleteness.COMPLETE,
  };

  it('hasWeightData checks emptyWeight and mtow', () => {
    expect(hasWeightData(skeleton)).toBe(false);
    expect(hasWeightData(complete)).toBe(true);
    expect(hasWeightData({ ...skeleton, emptyWeightKg: 500 })).toBe(false);
    expect(hasWeightData({ ...skeleton, emptyWeightKg: 500, mtowKg: 1000 })).toBe(true);
  });

  it('hasPerformanceData checks fuel and speed', () => {
    expect(hasPerformanceData(skeleton)).toBe(false);
    expect(hasPerformanceData(complete)).toBe(true);
  });

  it('hasStationData checks stations array', () => {
    expect(hasStationData(skeleton)).toBe(false);
    expect(hasStationData({ ...skeleton, stations: [] })).toBe(false);
    expect(hasStationData(complete)).toBe(true);
  });
});

describe('AircraftCatalogEntrySchema', () => {
  it('validates a complete entry', () => {
    const entry = {
      id: 'cltest123456789012345',
      name: 'Cessna 172S',
      icaoType: 'C172',
      manufacturer: 'Cessna',
      model: '172S Skyhawk SP',
      emptyWeightKg: 767,
      mtowKg: 1111,
      fuelCapacityL: 212,
      fuelBurnLph: 34,
      cruiseSpeedKts: 124,
      climbSpeedKts: 74,
      climbRateFpm: 730,
      descentSpeedKts: 100,
      descentRateFpm: 500,
      stations: [{ id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 0.94 }],
      source: 'curated',
      dataCompleteness: 'complete',
      isTemplate: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(AircraftCatalogEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('validates a skeleton entry with nulls', () => {
    const entry = {
      id: 'cltest123456789012345',
      name: 'Boeing 737-800',
      icaoType: 'B738',
      manufacturer: null,
      model: null,
      emptyWeightKg: null,
      mtowKg: null,
      fuelCapacityL: null,
      fuelBurnLph: null,
      cruiseSpeedKts: null,
      climbSpeedKts: null,
      climbRateFpm: null,
      descentSpeedKts: null,
      descentRateFpm: null,
      stations: null,
      source: 'simbrief',
      dataCompleteness: 'skeleton',
      isTemplate: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(AircraftCatalogEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = AircraftCatalogEntrySchema.safeParse({ id: 'test' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid dataCompleteness', () => {
    const entry = {
      id: 'cltest123456789012345',
      name: 'Test',
      icaoType: null,
      manufacturer: null,
      model: null,
      emptyWeightKg: null,
      mtowKg: null,
      fuelCapacityL: null,
      fuelBurnLph: null,
      cruiseSpeedKts: null,
      stations: null,
      source: null,
      dataCompleteness: 'unknown',
      isTemplate: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(AircraftCatalogEntrySchema.safeParse(entry).success).toBe(false);
  });

  it('rejects isTemplate: false (that is a user profile, not a catalog entry)', () => {
    const entry = {
      id: 'cltest1',
      name: 'My Custom C172',
      icaoType: 'C172',
      manufacturer: null,
      model: null,
      emptyWeightKg: null,
      mtowKg: null,
      fuelCapacityL: null,
      fuelBurnLph: null,
      cruiseSpeedKts: null,
      stations: null,
      source: null,
      dataCompleteness: 'skeleton',
      isTemplate: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(AircraftCatalogEntrySchema.safeParse(entry).success).toBe(false);
  });
});

describe('UserAircraftProfileSchema', () => {
  it('accepts isTemplate: false with clonedFromId', () => {
    const profile = {
      id: 'clprofile1',
      name: 'My Cessna 172',
      icaoType: 'C172',
      manufacturer: 'Cessna',
      model: '172S',
      emptyWeightKg: 767,
      mtowKg: 1111,
      fuelCapacityL: 212,
      fuelBurnLph: 34,
      cruiseSpeedKts: 124,
      climbSpeedKts: 74,
      climbRateFpm: 730,
      descentSpeedKts: 100,
      descentRateFpm: 500,
      stations: [{ id: 'pilot', labelKey: 'pilot', defaultKg: 80, maxKg: 120, arm: 0.94 }],
      source: 'curated',
      dataCompleteness: 'complete',
      isTemplate: false,
      isShared: false,
      clonedFromId: 'cltemplate1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(UserAircraftProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('accepts isTemplate: false with clonedFromId: null', () => {
    const profile = {
      id: 'clprofile2',
      name: 'Custom Aircraft',
      icaoType: null,
      manufacturer: null,
      model: null,
      emptyWeightKg: null,
      mtowKg: null,
      fuelCapacityL: null,
      fuelBurnLph: null,
      cruiseSpeedKts: null,
      climbSpeedKts: null,
      climbRateFpm: null,
      descentSpeedKts: null,
      descentRateFpm: null,
      stations: null,
      source: 'user',
      dataCompleteness: 'skeleton',
      isTemplate: false,
      isShared: false,
      clonedFromId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(UserAircraftProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('rejects isTemplate: true (that is a catalog entry, not a user profile)', () => {
    const profile = {
      id: 'clprofile3',
      name: 'Should Not Pass',
      icaoType: null,
      manufacturer: null,
      model: null,
      emptyWeightKg: null,
      mtowKg: null,
      fuelCapacityL: null,
      fuelBurnLph: null,
      cruiseSpeedKts: null,
      stations: null,
      source: null,
      dataCompleteness: 'skeleton',
      isTemplate: true,
      clonedFromId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(UserAircraftProfileSchema.safeParse(profile).success).toBe(false);
  });

  it('rejects missing clonedFromId field', () => {
    const profile = {
      id: 'clprofile4',
      name: 'Missing clonedFromId',
      icaoType: null,
      manufacturer: null,
      model: null,
      emptyWeightKg: null,
      mtowKg: null,
      fuelCapacityL: null,
      fuelBurnLph: null,
      cruiseSpeedKts: null,
      stations: null,
      source: null,
      dataCompleteness: 'skeleton',
      isTemplate: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(UserAircraftProfileSchema.safeParse(profile).success).toBe(false);
  });
});

// --------------- Mapper tests ---------------

describe('toCatalogEntry / toUserProfile mappers', () => {
  const now = new Date();

  const prismaTemplate: AircraftProfileWithStations = {
    id: 'tmpl-1',
    name: 'Cessna 172S',
    icaoType: 'C172',
    manufacturer: 'Cessna',
    model: '172S Skyhawk SP',
    emptyWeightKg: 767,
    mtowKg: 1111,
    fuelCapacityL: 212,
    fuelBurnLph: 34,
    cruiseSpeedKts: 124,
    climbSpeedKts: 74,
    climbRateFpm: 730,
    descentSpeedKts: 100,
    descentRateFpm: 500,
    stations: [
      { id: 'st-1', profileId: 'tmpl-1', stationId: 'pilot', labelKey: 'pilot', defaultKg: 80, maxKg: 120, arm: 0.94 },
    ],
    source: 'curated',
    dataCompleteness: 'complete',
    isTemplate: true,
    isShared: false,
    clonedFromId: null,
    userId: null,
    createdAt: now,
    updatedAt: now,
  };

  const prismaUserProfile: AircraftProfileWithStations = {
    ...prismaTemplate,
    id: 'prof-1',
    isTemplate: false,
    clonedFromId: 'tmpl-1',
    userId: 'user-123',
    source: 'user',
    dataCompleteness: 'partial',
    stations: [
      { id: 'st-2', profileId: 'prof-1', stationId: 'pilot', labelKey: 'pilot', defaultKg: 80, maxKg: 120, arm: 0.94 },
    ],
  };

  const prismaSkeletonProfile: AircraftProfileWithStations = {
    id: 'prof-2',
    name: 'Unknown Plane',
    icaoType: null,
    manufacturer: null,
    model: null,
    emptyWeightKg: null,
    mtowKg: null,
    fuelCapacityL: null,
    fuelBurnLph: null,
    cruiseSpeedKts: null,
    climbSpeedKts: null,
    climbRateFpm: null,
    descentSpeedKts: null,
    descentRateFpm: null,
    stations: [],
    source: null,
    dataCompleteness: 'skeleton',
    isTemplate: false,
    isShared: false,
    clonedFromId: null,
    userId: 'user-456',
    createdAt: now,
    updatedAt: now,
  };

  describe('toCatalogEntry', () => {
    it('sets isTemplate to true', () => {
      const result = toCatalogEntry(prismaTemplate);
      expect(result.isTemplate).toBe(true);
    });

    it('does not include userId', () => {
      const result = toCatalogEntry(prismaTemplate);
      expect('userId' in result).toBe(false);
    });

    it('does not include clonedFromId', () => {
      const result = toCatalogEntry(prismaTemplate);
      expect('clonedFromId' in result).toBe(false);
    });

    it('converts stations from AircraftProfileStation[] to WeightStation[]', () => {
      const result = toCatalogEntry(prismaTemplate);
      expect(result.stations).toEqual([
        { id: 'pilot', labelKey: 'pilot', defaultKg: 80, maxKg: 120, arm: 0.94 },
      ]);
    });

    it('converts source string to EnrichmentSource', () => {
      const result = toCatalogEntry(prismaTemplate);
      expect(result.source).toBe('curated');
    });

    it('converts dataCompleteness string to DataCompleteness', () => {
      const result = toCatalogEntry(prismaTemplate);
      expect(result.dataCompleteness).toBe('complete');
    });

    it('passes AircraftCatalogEntrySchema validation', () => {
      const result = toCatalogEntry(prismaTemplate);
      expect(AircraftCatalogEntrySchema.safeParse(result).success).toBe(true);
    });
  });

  describe('toUserProfile', () => {
    it('sets isTemplate to false', () => {
      const result = toUserProfile(prismaUserProfile);
      expect(result.isTemplate).toBe(false);
    });

    it('preserves clonedFromId', () => {
      const result = toUserProfile(prismaUserProfile);
      expect(result.clonedFromId).toBe('tmpl-1');
    });

    it('preserves clonedFromId: null for manually created profiles', () => {
      const result = toUserProfile(prismaSkeletonProfile);
      expect(result.clonedFromId).toBeNull();
    });

    it('does not include userId', () => {
      const result = toUserProfile(prismaUserProfile);
      expect('userId' in result).toBe(false);
    });

    it('converts stations from AircraftProfileStation[] to WeightStation[]', () => {
      const result = toUserProfile(prismaUserProfile);
      expect(result.stations).toEqual([
        { id: 'pilot', labelKey: 'pilot', defaultKg: 80, maxKg: 120, arm: 0.94 },
      ]);
    });

    it('maps empty stations array to null', () => {
      const result = toUserProfile(prismaSkeletonProfile);
      expect(result.stations).toBeNull();
    });

    it('handles null source', () => {
      const result = toUserProfile(prismaSkeletonProfile);
      expect(result.source).toBeNull();
    });

    it('converts source and dataCompleteness', () => {
      const result = toUserProfile(prismaUserProfile);
      expect(result.source).toBe('user');
      expect(result.dataCompleteness).toBe('partial');
    });

    it('passes UserAircraftProfileSchema validation', () => {
      const result = toUserProfile(prismaUserProfile);
      expect(UserAircraftProfileSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('baseFields', () => {
    it('maps all shared fields from Prisma record', () => {
      const result = baseFields(prismaTemplate);
      expect(result.id).toBe('tmpl-1');
      expect(result.name).toBe('Cessna 172S');
      expect(result.icaoType).toBe('C172');
      expect(result.manufacturer).toBe('Cessna');
      expect(result.model).toBe('172S Skyhawk SP');
      expect(result.emptyWeightKg).toBe(767);
      expect(result.mtowKg).toBe(1111);
      expect(result.fuelCapacityL).toBe(212);
      expect(result.fuelBurnLph).toBe(34);
      expect(result.cruiseSpeedKts).toBe(124);
      expect(result.createdAt).toBe(now);
      expect(result.updatedAt).toBe(now);
    });

    it('strips userId from output', () => {
      const result = baseFields(prismaUserProfile);
      expect('userId' in result).toBe(false);
    });

    it('strips isTemplate from output', () => {
      const result = baseFields(prismaTemplate);
      expect('isTemplate' in result).toBe(false);
    });

    it('strips clonedFromId from output', () => {
      const result = baseFields(prismaUserProfile);
      expect('clonedFromId' in result).toBe(false);
    });

    it('defaults dataCompleteness to skeleton when falsy', () => {
      const profile: AircraftProfileWithStations = {
        ...prismaSkeletonProfile,
        dataCompleteness: '',
      };
      const result = baseFields(profile);
      expect(result.dataCompleteness).toBe('skeleton');
    });
  });
});

// --------------- ZodValidationPipe tests ---------------

describe('ZodValidationPipe', () => {
  describe('with CreateAircraftProfileSchema', () => {
    const pipe = new ZodValidationPipe(CreateAircraftProfileSchema);

    it('passes valid create input', () => {
      const input = { name: 'Cessna 172S', icaoType: 'C172', emptyWeightKg: 767 };
      expect(pipe.transform(input)).toEqual(input);
    });

    it('passes valid input with stations', () => {
      const input = {
        name: 'Cessna 172S',
        icaoType: 'C172',
        stations: [{ id: 'pilot', labelKey: 'pilot', defaultKg: 80, maxKg: 120, arm: 0.94 }],
      };
      expect(pipe.transform(input)).toEqual(input);
    });

    it('rejects missing required name field', () => {
      expect(() => pipe.transform({ icaoType: 'C172' })).toThrow(BadRequestException);
    });

    it('rejects empty name', () => {
      expect(() => pipe.transform({ name: '', icaoType: 'C172' })).toThrow(BadRequestException);
    });

    it('rejects name exceeding max length', () => {
      expect(() => pipe.transform({ name: 'x'.repeat(101), icaoType: 'C172' })).toThrow(BadRequestException);
    });

    it('rejects missing icaoType', () => {
      expect(() => pipe.transform({ name: 'Test' })).toThrow(BadRequestException);
    });

    it('rejects non-integer cruiseSpeedKts', () => {
      expect(() => pipe.transform({ name: 'Test', icaoType: 'C172', cruiseSpeedKts: 124.5 })).toThrow(BadRequestException);
    });

    it('rejects negative cruiseSpeedKts', () => {
      expect(() => pipe.transform({ name: 'Test', icaoType: 'C172', cruiseSpeedKts: -10 })).toThrow(BadRequestException);
    });

    it('rejects invalid station shape', () => {
      expect(() =>
        pipe.transform({ name: 'Test', icaoType: 'C172', stations: [{ id: 'pilot' }] }),
      ).toThrow(BadRequestException);
    });

    it('strips unknown properties', () => {
      const result = pipe.transform({ name: 'Test', icaoType: 'C172', unknown: true }) as Record<string, unknown>;
      expect(result).toEqual({ name: 'Test', icaoType: 'C172' });
      expect('unknown' in result).toBe(false);
    });
  });

  describe('with UpdateAircraftProfileSchema', () => {
    const pipe = new ZodValidationPipe(UpdateAircraftProfileSchema);

    it('passes partial update with only name', () => {
      expect(pipe.transform({ name: 'New Name' })).toEqual({ name: 'New Name' });
    });

    it('passes empty object (all fields optional)', () => {
      expect(pipe.transform({})).toEqual({});
    });

    it('rejects invalid field type', () => {
      expect(() => pipe.transform({ emptyWeightKg: 'not a number' })).toThrow(BadRequestException);
    });
  });
});
