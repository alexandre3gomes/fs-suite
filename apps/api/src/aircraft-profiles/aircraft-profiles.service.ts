import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AircraftProfile } from '@prisma/client';

import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

import type { CreateAircraftProfileDto } from './dto/create-aircraft-profile.dto';
import type { UpdateAircraftProfileDto } from './dto/update-aircraft-profile.dto';

const CATALOG_CACHE_KEY = 'aircraft:catalog';
const CATALOG_CACHE_TTL = 86400; // 24h

@Injectable()
export class AircraftProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly redis: RedisService,
  ) {}

  async findAllTemplates(): Promise<AircraftProfile[]> {
    const client = this.redis.getClient();
    const cached = await client.get(CATALOG_CACHE_KEY).catch(() => null);
    if (cached) {
      return JSON.parse(cached);
    }

    const templates = await this.prisma.aircraftProfile.findMany({
      where: { isTemplate: true, userId: null },
      orderBy: [{ source: 'asc' }, { name: 'asc' }],
    });

    await client.setEx(CATALOG_CACHE_KEY, CATALOG_CACHE_TTL, JSON.stringify(templates)).catch(() => {});

    return templates;
  }

  async clone(templateId: string, userId: string): Promise<AircraftProfile> {
    const template = await this.prisma.aircraftProfile.findUnique({ where: { id: templateId } });
    if (!template || !template.isTemplate) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }

    const profile = await this.prisma.aircraftProfile.create({
      data: {
        name: template.name,
        icaoType: template.icaoType,
        manufacturer: template.manufacturer,
        model: template.model,
        emptyWeightKg: template.emptyWeightKg,
        mtowKg: template.mtowKg,
        fuelCapacityL: template.fuelCapacityL,
        fuelBurnLph: template.fuelBurnLph,
        cruiseSpeedKts: template.cruiseSpeedKts,
        stations: template.stations ?? undefined,
        source: template.source,
        isTemplate: false,
        clonedFromId: template.id,
        userId,
      },
    });

    void this.activity.log('aircraft_profile.cloned', userId, {
      profileId: profile.id,
      templateId,
    });

    return profile;
  }

  async findAllByUser(userId: string): Promise<AircraftProfile[]> {
    return this.prisma.aircraftProfile.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(userId: string, dto: CreateAircraftProfileDto): Promise<AircraftProfile> {
    const { stations, ...fields } = dto;
    const profile = await this.prisma.aircraftProfile.create({
      data: {
        ...fields,
        stations: stations ? JSON.parse(JSON.stringify(stations)) : undefined,
        userId,
      },
    });
    void this.activity.log('aircraft_profile.created', userId, { profileId: profile.id });
    return profile;
  }

  async update(id: string, userId: string, dto: UpdateAircraftProfileDto): Promise<AircraftProfile> {
    const profile = await this.findOneOrFail(id, userId);
    const { stations, ...fields } = dto;
    const updated = await this.prisma.aircraftProfile.update({
      where: { id: profile.id },
      data: {
        ...fields,
        ...(stations !== undefined
          ? { stations: JSON.parse(JSON.stringify(stations)) }
          : {}),
      },
    });
    void this.activity.log('aircraft_profile.updated', userId, { profileId: id });
    return updated;
  }

  async remove(id: string, userId: string): Promise<void> {
    const profile = await this.findOneOrFail(id, userId);
    await this.prisma.aircraftProfile.delete({ where: { id: profile.id } });
    void this.activity.log('aircraft_profile.deleted', userId, { profileId: id });
  }

  private async findOneOrFail(id: string, userId: string): Promise<AircraftProfile> {
    const profile = await this.prisma.aircraftProfile.findUnique({ where: { id } });
    if (!profile) {
      throw new NotFoundException(`Aircraft profile ${id} not found`);
    }
    if (profile.userId !== userId) {
      throw new ForbiddenException();
    }
    return profile;
  }
}
