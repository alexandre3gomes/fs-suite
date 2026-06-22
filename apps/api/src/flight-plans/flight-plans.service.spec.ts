import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { ActivityService } from '../activity/activity.service';
import type { PrismaService } from '../prisma/prisma.service';

import { FlightPlansService } from './flight-plans.service';

// --------------- suggestRunway (pure: VFR flow step 3) ---------------

describe('FlightPlansService.suggestRunway', () => {
  // No DB access in this method, so null deps are fine.
  const svc = new FlightPlansService(
    null as unknown as PrismaService,
    null as unknown as ActivityService,
  );

  const rwy09_27 = {
    leIdent: '09',
    leHeadingDeg: 90,
    heIdent: '27',
    heHeadingDeg: 270,
    closed: false,
  };

  it('picks the threshold most aligned into the wind', () => {
    // Wind from 270° favours runway 27 (headwind down 270°).
    const r = svc.suggestRunway(270, 10, [rwy09_27]);
    expect(r?.runwayIdent).toBe('27');
    expect(r?.headwindKts).toBeCloseTo(10, 1);
    expect(r?.crosswindKts).toBeCloseTo(0, 1);
  });

  it('picks the opposite threshold when the wind reverses', () => {
    const r = svc.suggestRunway(90, 12, [rwy09_27]);
    expect(r?.runwayIdent).toBe('09');
    expect(r?.headwindKts).toBeCloseTo(12, 1);
  });

  it('reports the crosswind component for an oblique wind', () => {
    // Wind from 360° onto a 09/27 strip: pure crosswind, ~0 headwind.
    const r = svc.suggestRunway(360, 10, [rwy09_27]);
    expect(r).not.toBeNull();
    expect(r?.crosswindKts).toBeCloseTo(10, 1);
    expect(Math.abs(r?.headwindKts ?? 0)).toBeLessThan(0.01);
  });

  it('returns null when the wind is variable or unknown', () => {
    expect(svc.suggestRunway('VRB', 5, [rwy09_27])).toBeNull();
    expect(svc.suggestRunway(null, 5, [rwy09_27])).toBeNull();
  });

  it('returns null when no runways are usable', () => {
    expect(svc.suggestRunway(270, 10, [])).toBeNull();
    expect(svc.suggestRunway(270, 10, [{ ...rwy09_27, closed: true }])).toBeNull();
  });

  it('ignores thresholds without ident or heading data', () => {
    const r = svc.suggestRunway(270, 10, [
      { leIdent: null, leHeadingDeg: null, heIdent: '27', heHeadingDeg: 270, closed: false },
    ]);
    expect(r?.runwayIdent).toBe('27');
  });
});

// --------------- calculateRoutePerformance (pure) ---------------

describe('FlightPlansService.calculateRoutePerformance', () => {
  const svc = new FlightPlansService(
    null as unknown as PrismaService,
    null as unknown as ActivityService,
  );

  it('returns cruise speed as ground speed in calm wind and sums time/fuel', () => {
    const out = svc.calculateRoutePerformance({
      legs: [
        { distanceNm: 120, trueCourse: 90, magneticCourse: 90 },
        { distanceNm: 60, trueCourse: 180, magneticCourse: 180 },
      ],
      windDirection: null,
      windSpeed: null,
      cruiseSpeedKts: 120,
      fuelBurnLph: 30,
    });
    expect(out.legs).toHaveLength(2);
    expect(out.legs[0]?.groundSpeedKts).toBeCloseTo(120, 1);
    // 120 NM @ 120 kt = 60 min, 60 NM @ 120 kt = 30 min => 90 min total.
    expect(out.totalTimeMin).toBeCloseTo(90, 1);
    expect(out.avgGroundSpeed).toBe(120);
    // 30 L/h over 1.5 h = 45 L.
    expect(out.totalFuelL).toBeCloseTo(45, 1);
  });

  it('falls back to cruise speed for average when there is no time', () => {
    const out = svc.calculateRoutePerformance({
      legs: [],
      windDirection: null,
      windSpeed: null,
      cruiseSpeedKts: 110,
      fuelBurnLph: 30,
    });
    expect(out.totalTimeMin).toBe(0);
    expect(out.avgGroundSpeed).toBe(110);
    expect(out.totalFuelL).toBe(0);
  });
});

// --------------- ownership & soft-delete rules ---------------

interface MockPrisma {
  flightPlan: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function makeService(): { svc: FlightPlansService; prisma: MockPrisma } {
  const prisma: MockPrisma = {
    flightPlan: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
  const activity = { log: vi.fn() } as unknown as ActivityService;
  const svc = new FlightPlansService(prisma as unknown as PrismaService, activity);
  return { svc, prisma };
}

describe('FlightPlansService ownership rules', () => {
  it('findAll scopes to the user and excludes soft-deleted plans', async () => {
    const { svc, prisma } = makeService();
    prisma.flightPlan.findMany.mockResolvedValue([]);

    await svc.findAll('user-1');

    expect(prisma.flightPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', deletedAt: null } }),
    );
  });

  it('findOne returns the plan to its owner', async () => {
    const { svc, prisma } = makeService();
    prisma.flightPlan.findUnique.mockResolvedValue({ id: 'p1', userId: 'user-1', deletedAt: null });

    await expect(svc.findOne('p1', 'user-1')).resolves.toMatchObject({ id: 'p1' });
  });

  it('findOne throws NotFound when the plan does not exist', async () => {
    const { svc, prisma } = makeService();
    prisma.flightPlan.findUnique.mockResolvedValue(null);

    await expect(svc.findOne('missing', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOne throws NotFound for a soft-deleted plan', async () => {
    const { svc, prisma } = makeService();
    prisma.flightPlan.findUnique.mockResolvedValue({ id: 'p1', userId: 'user-1', deletedAt: new Date() });

    await expect(svc.findOne('p1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOne forbids access to another user\'s plan', async () => {
    const { svc, prisma } = makeService();
    prisma.flightPlan.findUnique.mockResolvedValue({ id: 'p1', userId: 'owner', deletedAt: null });

    await expect(svc.findOne('p1', 'intruder')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('remove soft-deletes (sets deletedAt) after an ownership check', async () => {
    const { svc, prisma } = makeService();
    prisma.flightPlan.findUnique.mockResolvedValue({ id: 'p1', userId: 'user-1', deletedAt: null });
    prisma.flightPlan.update.mockResolvedValue({});

    await svc.remove('p1', 'user-1');

    expect(prisma.flightPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('remove refuses to delete another user\'s plan and does not write', async () => {
    const { svc, prisma } = makeService();
    prisma.flightPlan.findUnique.mockResolvedValue({ id: 'p1', userId: 'owner', deletedAt: null });

    await expect(svc.remove('p1', 'intruder')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.flightPlan.update).not.toHaveBeenCalled();
  });
});
