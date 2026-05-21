import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { FlightPlan, Prisma } from '@prisma/client';

import { ActivityService } from '../activity/activity.service';
import { windTriangle as sharedWindTriangle } from '../common/wind.utils';
import { PrismaService } from '../prisma/prisma.service';

import type { CreateFlightPlanDto } from './dto/create-flight-plan.dto';
import type { UpdateFlightPlanDto } from './dto/update-flight-plan.dto';

function mapPlanFields(dto: Partial<CreateFlightPlanDto>): Partial<Omit<Prisma.FlightPlanCreateInput, 'user' | 'routes' | 'visualReferences' | 'briefingItems'>> {
  return {
    flightRules: dto.flightRules,
    originIcao: dto.originIcao,
    originName: dto.originName,
    originElevationFt: dto.originElevationFt,
    originRunwayInUse: dto.originRunwayInUse,
    originMetarRaw: dto.originMetarRaw,
    destinationIcao: dto.destinationIcao,
    destinationName: dto.destinationName,
    destinationElevationFt: dto.destinationElevationFt,
    destinationRunwayInUse: dto.destinationRunwayInUse,
    destinationMetarRaw: dto.destinationMetarRaw,
    alternateIcao: dto.alternateIcao,
    alternateName: dto.alternateName,
    alternateElevationFt: dto.alternateElevationFt,
    alternateRunwayInUse: dto.alternateRunwayInUse,
    alternateMetarRaw: dto.alternateMetarRaw,
    aircraftType: dto.aircraftType,
    aircraftName: dto.aircraftName,
    emptyWeightKg: dto.emptyWeightKg,
    takeoffWeightKg: dto.takeoffWeightKg,
    mtowKg: dto.mtowKg,
    fuelCapacityL: dto.fuelCapacityL,
    fuelBurnLph: dto.fuelBurnLph,
    aircraftStations: dto.aircraftStations != null
      ? JSON.parse(JSON.stringify(dto.aircraftStations))
      : undefined,
    cruiseSpeedKts: dto.cruiseSpeedKts,
    callsign: dto.callsign,
    registration: dto.registration,
    simbriefOfpId: dto.simbriefOfpId,
    equipmentCode: dto.equipmentCode,
    surveillanceCode: dto.surveillanceCode,
    routeText: dto.routeText,
    cruiseLevel: dto.cruiseLevel,
    plannedAltitude: dto.plannedAltitude,
    remarks: dto.remarks,
    todMinutes: dto.todMinutes,
    todDistanceNm: dto.todDistanceNm,
    fuelConsumptionPerHour: dto.fuelConsumptionPerHour,
    fuelCurrentTotal: dto.fuelCurrentTotal,
    fuelReserveMinutes: dto.fuelReserveMinutes,
    fuelRequiredTotal: dto.fuelRequiredTotal,
    fuelPerWing: dto.fuelPerWing,
    enduranceMinutes: dto.enduranceMinutes,
    personsOnBoard: dto.personsOnBoard,
    pilotInCommand: dto.pilotInCommand,
    aircraftColorMarkings: dto.aircraftColorMarkings,
    plannedDepartureUtc: dto.plannedDepartureUtc ? new Date(dto.plannedDepartureUtc) : undefined,
    estimatedElapsedMin: dto.estimatedElapsedMin,
    estimatedArrivalUtc: dto.estimatedArrivalUtc ? new Date(dto.estimatedArrivalUtc) : undefined,
    totalDistanceNm: dto.totalDistanceNm,
    weatherBasis: dto.weatherBasis,
    avgWindSpeed: dto.avgWindSpeed,
    avgWindDirection: dto.avgWindDirection,
    groundSpeed: dto.groundSpeed,
  };
}

const INCLUDE_RELATIONS = {
  routes: { orderBy: { sequence: 'asc' as const } },
  visualReferences: { orderBy: { sequence: 'asc' as const } },
  briefingItems: true,
};

@Injectable()
export class FlightPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async create(userId: string, dto: CreateFlightPlanDto): Promise<FlightPlan> {
    const { routes, visualReferences, briefingItems } = dto;

    const plan = await this.prisma.flightPlan.create({
      data: {
        ...(mapPlanFields(dto) as Omit<Prisma.FlightPlanUncheckedCreateInput, 'userId'>),
        userId,
        routes: routes?.length ? { createMany: { data: routes } } : undefined,
        visualReferences: visualReferences?.length
          ? { createMany: { data: visualReferences } }
          : undefined,
        briefingItems: briefingItems?.length
          ? { createMany: { data: briefingItems } }
          : undefined,
      },
      include: INCLUDE_RELATIONS,
    });

    void this.activity.log('flight_plan.created', userId, { flightPlanId: plan.id });

    return plan;
  }

  async findAll(userId: string): Promise<FlightPlan[]> {
    return this.prisma.flightPlan.findMany({
      where: { userId, deletedAt: null },
      include: INCLUDE_RELATIONS,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string): Promise<FlightPlan> {
    const plan = await this.prisma.flightPlan.findUnique({
      where: { id },
      include: INCLUDE_RELATIONS,
    });

    if (!plan || plan.deletedAt !== null) {
      throw new NotFoundException('Flight plan not found');
    }
    if (plan.userId !== userId) {
      throw new ForbiddenException();
    }

    return plan;
  }

  async update(id: string, userId: string, dto: UpdateFlightPlanDto): Promise<FlightPlan> {
    await this.findOne(id, userId);

    const { routes, visualReferences, briefingItems, status } = dto;

    const updated = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.FlightPlanUpdateInput = {
        ...mapPlanFields(dto),
        ...(status !== undefined ? { status } : {}),
      };

      if (routes !== undefined) {
        await tx.flightPlanRoute.deleteMany({ where: { flightPlanId: id } });
        data.routes = { createMany: { data: routes } };
      }

      if (visualReferences !== undefined) {
        await tx.flightPlanVisualReference.deleteMany({ where: { flightPlanId: id } });
        data.visualReferences = { createMany: { data: visualReferences } };
      }

      if (briefingItems !== undefined) {
        await tx.flightPlanBriefingItem.deleteMany({ where: { flightPlanId: id } });
        data.briefingItems = { createMany: { data: briefingItems } };
      }

      return tx.flightPlan.update({
        where: { id },
        data,
        include: INCLUDE_RELATIONS,
      });
    });

    void this.activity.log('flight_plan.updated', userId, { flightPlanId: id });

    return updated;
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.findOne(id, userId);

    await this.prisma.flightPlan.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    void this.activity.log('flight_plan.deleted', userId, { flightPlanId: id });
  }

  async duplicate(id: string, userId: string): Promise<FlightPlan> {
    const original = await this.findOne(id, userId) as FlightPlan & {
      routes: { sequence: number; waypointIdent: string; latitude: number | null; longitude: number | null; airway: string | null }[];
      visualReferences: { sequence: number; name: string; distanceNm: number | null; timeMin: number | null }[];
      briefingItems: { code: string; label: string; checked: boolean; notes: string | null }[];
    };

    const plan = await this.prisma.$transaction(async (tx) => {
      return tx.flightPlan.create({
        data: {
          userId,
          status: 'DRAFT',
          flightRules: original.flightRules,
          originIcao: original.originIcao,
          originName: original.originName,
          originElevationFt: original.originElevationFt,
          originRunwayInUse: original.originRunwayInUse,
          originMetarRaw: original.originMetarRaw,
          destinationIcao: original.destinationIcao,
          destinationName: original.destinationName,
          destinationElevationFt: original.destinationElevationFt,
          destinationRunwayInUse: original.destinationRunwayInUse,
          destinationMetarRaw: original.destinationMetarRaw,
          alternateIcao: original.alternateIcao,
          alternateName: original.alternateName,
          alternateElevationFt: original.alternateElevationFt,
          alternateRunwayInUse: original.alternateRunwayInUse,
          alternateMetarRaw: original.alternateMetarRaw,
          aircraftType: original.aircraftType,
          aircraftName: original.aircraftName,
          emptyWeightKg: original.emptyWeightKg,
          takeoffWeightKg: original.takeoffWeightKg,
          mtowKg: original.mtowKg,
          fuelCapacityL: original.fuelCapacityL,
          fuelBurnLph: original.fuelBurnLph,
          aircraftStations: original.aircraftStations ?? undefined,
          cruiseSpeedKts: original.cruiseSpeedKts,
          callsign: original.callsign,
          registration: original.registration,
          simbriefOfpId: original.simbriefOfpId,
          equipmentCode: original.equipmentCode,
          surveillanceCode: original.surveillanceCode,
          routeText: original.routeText,
          cruiseLevel: original.cruiseLevel,
          plannedAltitude: original.plannedAltitude,
          remarks: original.remarks,
          todMinutes: original.todMinutes,
          todDistanceNm: original.todDistanceNm,
          plannedDepartureUtc: original.plannedDepartureUtc,
          estimatedElapsedMin: original.estimatedElapsedMin,
          estimatedArrivalUtc: original.estimatedArrivalUtc,
          totalDistanceNm: original.totalDistanceNm,
          weatherBasis: original.weatherBasis,
          fuelConsumptionPerHour: original.fuelConsumptionPerHour,
          fuelCurrentTotal: original.fuelCurrentTotal,
          fuelReserveMinutes: original.fuelReserveMinutes,
          fuelRequiredTotal: original.fuelRequiredTotal,
          fuelPerWing: original.fuelPerWing,
          enduranceMinutes: original.enduranceMinutes,
          personsOnBoard: original.personsOnBoard,
          pilotInCommand: original.pilotInCommand,
          aircraftColorMarkings: original.aircraftColorMarkings,
          routes: original.routes.length
            ? {
                createMany: {
                  data: original.routes.map((r) => ({
                    sequence: r.sequence,
                    waypointIdent: r.waypointIdent,
                    latitude: r.latitude,
                    longitude: r.longitude,
                    airway: r.airway,
                  })),
                },
              }
            : undefined,
          visualReferences: original.visualReferences.length
            ? {
                createMany: {
                  data: original.visualReferences.map((r) => ({
                    sequence: r.sequence,
                    name: r.name,
                    distanceNm: r.distanceNm,
                    timeMin: r.timeMin,
                  })),
                },
              }
            : undefined,
          briefingItems: original.briefingItems.length
            ? {
                createMany: {
                  data: original.briefingItems.map((b) => ({
                    code: b.code,
                    label: b.label,
                    checked: b.checked,
                    notes: b.notes,
                  })),
                },
              }
            : undefined,
        },
        include: INCLUDE_RELATIONS,
      });
    });

    void this.activity.log('flight_plan.duplicated', userId, { originalId: id, newId: plan.id });

    return plan;
  }

  suggestRunway(
    windDirection: number | string | null,
    windSpeed: number | null,
    runways: { leIdent: string | null; leHeadingDeg: number | null; heIdent: string | null; heHeadingDeg: number | null; closed: boolean }[],
  ): { runwayIdent: string; headwindKts: number; crosswindKts: number } | null {
    if (windDirection === null || windDirection === 'VRB' || typeof windDirection !== 'number') {
      return null;
    }

    const ws = windSpeed ?? 0;
    const openRunways = runways.filter((r) => !r.closed);
    if (openRunways.length === 0) return null;

    let bestIdent: string | null = null;
    let bestHeadwind = -Infinity;
    let bestCrosswind = 0;

    for (const rwy of openRunways) {
      const thresholds = [
        { ident: rwy.leIdent, heading: rwy.leHeadingDeg },
        { ident: rwy.heIdent, heading: rwy.heHeadingDeg },
      ];

      for (const t of thresholds) {
        if (!t.ident || t.heading === null) continue;
        const diffRad = ((windDirection - t.heading) * Math.PI) / 180;
        const headwind = ws * Math.cos(diffRad);
        const crosswind = Math.abs(ws * Math.sin(diffRad));

        if (headwind > bestHeadwind) {
          bestHeadwind = headwind;
          bestCrosswind = crosswind;
          bestIdent = t.ident;
        }
      }
    }

    if (!bestIdent) return null;

    return {
      runwayIdent: bestIdent,
      headwindKts: Math.round(bestHeadwind * 10) / 10,
      crosswindKts: Math.round(bestCrosswind * 10) / 10,
    };
  }

  calculateRoutePerformance(params: {
    legs: { distanceNm: number; trueCourse: number; magneticCourse: number }[];
    windDirection: number | null;
    windSpeed: number | null;
    cruiseSpeedKts: number;
    fuelBurnLph: number;
  }): {
    legs: { groundSpeedKts: number; windCorrectionAngle: number; magneticHeading: number; timeMin: number }[];
    totalTimeMin: number;
    totalFuelL: number;
    avgGroundSpeed: number;
  } {
    const { legs, windDirection, windSpeed, cruiseSpeedKts, fuelBurnLph } = params;

    const enriched = legs.map((leg) => {
      const { groundSpeed, wca } = this.windTriangle(
        cruiseSpeedKts,
        leg.trueCourse,
        windDirection,
        windSpeed,
      );
      const timeMin = groundSpeed > 0 ? (leg.distanceNm / groundSpeed) * 60 : 0;
      const mh = ((leg.magneticCourse + wca) % 360 + 360) % 360;

      return {
        groundSpeedKts: groundSpeed,
        windCorrectionAngle: wca,
        magneticHeading: Math.round(mh),
        timeMin: Math.round(timeMin * 10) / 10,
      };
    });

    const totalTimeMin = enriched.reduce((s, l) => s + l.timeMin, 0);
    const totalDist = legs.reduce((s, l) => s + l.distanceNm, 0);
    const avgGroundSpeed = totalTimeMin > 0 ? Math.round(totalDist / (totalTimeMin / 60)) : cruiseSpeedKts;
    const totalFuelL = fuelBurnLph * (totalTimeMin / 60);

    return { legs: enriched, totalTimeMin, totalFuelL, avgGroundSpeed };
  }

  private windTriangle(
    tas: number,
    trueCourse: number,
    windDirection: number | null,
    windSpeed: number | null,
  ): { groundSpeed: number; wca: number } {
    return sharedWindTriangle(tas, trueCourse, windDirection, windSpeed);
  }
}
