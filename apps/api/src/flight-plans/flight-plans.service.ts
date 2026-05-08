import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { FlightPlan, PlanStatus } from '@prisma/client';

import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';

import type { CreateFlightPlanDto } from './dto/create-flight-plan.dto';
import type { UpdateFlightPlanDto } from './dto/update-flight-plan.dto';

interface PaginatedResult {
  items: FlightPlan[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class FlightPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async findAll(userId: string, page: number, limit: number): Promise<PaginatedResult> {
    const where = { userId, deletedAt: null };

    const [items, total] = await Promise.all([
      this.prisma.flightPlan.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          origin: { select: { icao: true, name: true, city: true } },
          destination: { select: { icao: true, name: true, city: true } },
        },
      }),
      this.prisma.flightPlan.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, userId: string): Promise<FlightPlan> {
    const plan = await this.prisma.flightPlan.findUnique({
      where: { id },
      include: {
        origin: true,
        destination: true,
        aircraftProfile: true,
        routes: { orderBy: { sequence: 'asc' } },
      },
    });

    if (!plan || plan.deletedAt) {
      throw new NotFoundException(`Flight plan ${id} not found`);
    }
    if (plan.userId !== userId) {
      throw new ForbiddenException();
    }

    return plan;
  }

  async create(userId: string, dto: CreateFlightPlanDto): Promise<FlightPlan> {
    const { routes, ...planData } = dto;

    const plan = await this.prisma.flightPlan.create({
      data: {
        ...planData,
        flightType: planData.flightType as 'VFR' | 'IFR',
        userId,
        routes: routes?.length
          ? { create: routes }
          : undefined,
      },
      include: {
        origin: true,
        destination: true,
        aircraftProfile: true,
        routes: { orderBy: { sequence: 'asc' } },
      },
    });

    void this.activity.log('flight_plan.created', userId, { flightPlanId: plan.id });

    return plan;
  }

  async update(id: string, userId: string, dto: UpdateFlightPlanDto): Promise<FlightPlan> {
    await this.findOne(id, userId);

    const { routes, ...planData } = dto;

    // If routes are provided, replace all existing routes
    const routeOps = routes !== undefined
      ? {
          deleteMany: { flightPlanId: id },
          create: routes,
        }
      : undefined;

    const updated = await this.prisma.flightPlan.update({
      where: { id },
      data: {
        ...planData,
        status: planData.status as PlanStatus | undefined,
        flightType: planData.flightType as 'VFR' | 'IFR' | undefined,
        routes: routeOps,
      },
      include: {
        origin: true,
        destination: true,
        aircraftProfile: true,
        routes: { orderBy: { sequence: 'asc' } },
      },
    });

    void this.activity.log('flight_plan.updated', userId, { flightPlanId: id });

    return updated;
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.findOne(id, userId);

    // Soft delete
    await this.prisma.flightPlan.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    void this.activity.log('flight_plan.deleted', userId, { flightPlanId: id });
  }

  async duplicate(id: string, userId: string): Promise<FlightPlan> {
    const original = await this.findOne(id, userId) as FlightPlan & {
      routes: { sequence: number; waypointIdent: string; latitude: number | null; longitude: number | null; airway: string | null }[];
    };

    const plan = await this.prisma.flightPlan.create({
      data: {
        flightType: original.flightType,
        originIcao: original.originIcao,
        destinationIcao: original.destinationIcao,
        plannedAltitude: original.plannedAltitude,
        remarks: original.remarks,
        aircraftProfileId: original.aircraftProfileId,
        userId,
        status: 'DRAFT',
        routes: {
          create: original.routes.map((r) => ({
            sequence: r.sequence,
            waypointIdent: r.waypointIdent,
            latitude: r.latitude,
            longitude: r.longitude,
            airway: r.airway,
          })),
        },
      },
      include: {
        origin: true,
        destination: true,
        aircraftProfile: true,
        routes: { orderBy: { sequence: 'asc' } },
      },
    });

    void this.activity.log('flight_plan.duplicated', userId, {
      originalId: id,
      newId: plan.id,
    });

    return plan;
  }
}
