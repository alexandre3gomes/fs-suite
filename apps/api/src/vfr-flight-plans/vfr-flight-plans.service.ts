import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, VfrFlightPlan } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import type { CreateVfrFlightPlanDto } from './dto/create-vfr-flight-plan.dto';
import type { UpdateVfrFlightPlanDto } from './dto/update-vfr-flight-plan.dto';

const INCLUDE_RELATIONS = {
  visualReferences: { orderBy: { sequence: 'asc' as const } },
  briefingItems: true,
};

@Injectable()
export class VfrFlightPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateVfrFlightPlanDto): Promise<VfrFlightPlan> {
    const { visualReferences, briefingItems, ...planData } = dto;

    return this.prisma.vfrFlightPlan.create({
      data: {
        ...planData,
        userId,
        visualReferences: visualReferences
          ? { createMany: { data: visualReferences } }
          : undefined,
        briefingItems: briefingItems ? { createMany: { data: briefingItems } } : undefined,
      },
      include: INCLUDE_RELATIONS,
    });
  }

  async findAll(userId: string): Promise<VfrFlightPlan[]> {
    return this.prisma.vfrFlightPlan.findMany({
      where: { userId, deletedAt: null },
      include: INCLUDE_RELATIONS,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string): Promise<VfrFlightPlan> {
    const plan = await this.prisma.vfrFlightPlan.findUnique({
      where: { id },
      include: INCLUDE_RELATIONS,
    });

    if (!plan || plan.deletedAt !== null) {
      throw new NotFoundException(`VFR flight plan not found`);
    }
    if (plan.userId !== userId) {
      throw new ForbiddenException();
    }

    return plan;
  }

  async update(id: string, userId: string, dto: UpdateVfrFlightPlanDto): Promise<VfrFlightPlan> {
    // Verify ownership
    await this.findOne(id, userId);

    const { visualReferences, briefingItems, ...planData } = dto;

    // Build update data
    const data: Prisma.VfrFlightPlanUpdateInput = { ...planData };

    // Replace visual references if provided
    if (visualReferences !== undefined) {
      await this.prisma.vfrFlightPlanVisualReference.deleteMany({
        where: { flightPlanId: id },
      });
      data.visualReferences = { createMany: { data: visualReferences } };
    }

    // Replace briefing items if provided
    if (briefingItems !== undefined) {
      await this.prisma.vfrFlightPlanBriefingItem.deleteMany({
        where: { flightPlanId: id },
      });
      data.briefingItems = { createMany: { data: briefingItems } };
    }

    return this.prisma.vfrFlightPlan.update({
      where: { id },
      data,
      include: INCLUDE_RELATIONS,
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.findOne(id, userId);

    // Soft delete
    await this.prisma.vfrFlightPlan.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Suggest the best runway based on wind direction from METAR.
   * Returns the runway threshold identifier with the least tailwind component.
   */
  suggestRunway(
    windDirection: number | string | null,
    runways: { leIdent: string | null; leHeadingDeg: number | null; heIdent: string | null; heHeadingDeg: number | null; closed: boolean }[],
  ): string | null {
    // Cannot suggest if wind is variable, calm, or missing
    if (windDirection === null || windDirection === 'VRB' || typeof windDirection !== 'number') {
      return null;
    }

    const openRunways = runways.filter((r) => !r.closed);
    if (openRunways.length === 0) return null;

    let bestIdent: string | null = null;
    let bestHeadwind = -Infinity;

    for (const rwy of openRunways) {
      const thresholds = [
        { ident: rwy.leIdent, heading: rwy.leHeadingDeg },
        { ident: rwy.heIdent, heading: rwy.heHeadingDeg },
      ];

      for (const t of thresholds) {
        if (!t.ident || t.heading === null) continue;

        // Headwind component = wind_speed * cos(wind_dir - runway_heading)
        // We only care about direction alignment, not speed magnitude
        const diff = ((windDirection - t.heading + 540) % 360) - 180;
        const headwindFactor = Math.cos((diff * Math.PI) / 180);

        if (headwindFactor > bestHeadwind) {
          bestHeadwind = headwindFactor;
          bestIdent = t.ident;
        }
      }
    }

    return bestIdent;
  }
}
