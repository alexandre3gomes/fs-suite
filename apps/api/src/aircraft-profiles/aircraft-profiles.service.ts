import type { AircraftBaseFields, AircraftCatalogEntry, DataCompleteness, EnrichmentSource, UserAircraftProfile, WeightStation } from '@fs-suite/types';
import { computeDataCompleteness } from '@fs-suite/types';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AircraftProfile, AircraftProfileStation } from '@prisma/client';

import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

import type { CreateAircraftProfileDto } from './dto/create-aircraft-profile.dto';
import type { UpdateAircraftProfileDto } from './dto/update-aircraft-profile.dto';

const CATALOG_CACHE_KEY = 'aircraft:catalog';
const CATALOG_CACHE_TTL = 86400; // 24h

export type AircraftProfileWithStations = AircraftProfile & {
  stations: AircraftProfileStation[];
};

function toStationCreate(s: WeightStation): Omit<AircraftProfileStation, 'id' | 'profileId'> {
  return { stationId: s.id, labelKey: s.labelKey, defaultKg: s.defaultKg, maxKg: s.maxKg, arm: s.arm };
}

function mapStation(s: AircraftProfileStation): WeightStation {
  return { id: s.stationId, labelKey: s.labelKey, defaultKg: s.defaultKg, maxKg: s.maxKg, arm: s.arm };
}

@Injectable()
export class AircraftProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly redis: RedisService,
  ) {}

  async findAllTemplates(): Promise<AircraftCatalogEntry[]> {
    const client = this.redis.getClient();
    const cached = await client.get(CATALOG_CACHE_KEY).catch(() => null);
    if (cached) {
      return JSON.parse(cached);
    }

    const templates = await this.prisma.aircraftProfile.findMany({
      where: { isTemplate: true, userId: null },
      orderBy: [{ source: 'asc' }, { name: 'asc' }],
      include: { stations: true },
    });

    const entries = templates.map(toCatalogEntry);
    if (entries.length > 0) {
      await client.setEx(CATALOG_CACHE_KEY, CATALOG_CACHE_TTL, JSON.stringify(entries)).catch(() => {});
    }

    return entries;
  }

  async findAllShared(): Promise<UserAircraftProfile[]> {
    const profiles = await this.prisma.aircraftProfile.findMany({
      where: { isTemplate: false, isShared: true },
      orderBy: [{ icaoType: 'asc' }, { name: 'asc' }],
      include: { stations: true },
    });
    return profiles.map(toUserProfile);
  }

  async clone(templateId: string, userId: string): Promise<UserAircraftProfile> {
    const template = await this.prisma.aircraftProfile.findUnique({
      where: { id: templateId },
      include: { stations: true },
    });
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
        climbSpeedKts: template.climbSpeedKts,
        climbRateFpm: template.climbRateFpm,
        descentSpeedKts: template.descentSpeedKts,
        descentRateFpm: template.descentRateFpm,
        source: template.source,
        dataCompleteness: template.dataCompleteness,
        isTemplate: false,
        clonedFromId: template.id,
        userId,
        ...(template.stations.length > 0
          ? { stations: { create: template.stations.map((s) => toStationCreate(mapStation(s))) } }
          : {}),
      },
      include: { stations: true },
    });

    void this.activity.log('aircraft_profile.cloned', userId, {
      profileId: profile.id,
      templateId,
    });

    return toUserProfile(profile);
  }

  async findAllByUser(userId: string): Promise<UserAircraftProfile[]> {
    const profiles = await this.prisma.aircraftProfile.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { stations: true },
    });
    return profiles.map(toUserProfile);
  }

  async create(userId: string, dto: CreateAircraftProfileDto): Promise<UserAircraftProfile> {
    const { stations, ...fields } = dto;
    const completeness = computeDataCompleteness({
      ...fields,
      stations: stations ?? null,
    });
    const profile = await this.prisma.aircraftProfile.create({
      data: {
        ...fields,
        dataCompleteness: completeness,
        userId,
        ...(stations
          ? { stations: { create: stations.map(toStationCreate) } }
          : {}),
      },
      include: { stations: true },
    });
    void this.activity.log('aircraft_profile.created', userId, { profileId: profile.id });
    return toUserProfile(profile);
  }

  async update(id: string, userId: string, dto: UpdateAircraftProfileDto): Promise<UserAircraftProfile> {
    const profile = await this.findOneOrFail(id, userId);
    const { stations, ...fields } = dto;

    const merged = {
      emptyWeightKg: fields.emptyWeightKg ?? profile.emptyWeightKg,
      mtowKg: fields.mtowKg ?? profile.mtowKg,
      fuelCapacityL: fields.fuelCapacityL ?? profile.fuelCapacityL,
      fuelBurnLph: fields.fuelBurnLph ?? profile.fuelBurnLph,
      cruiseSpeedKts: fields.cruiseSpeedKts ?? profile.cruiseSpeedKts,
      climbSpeedKts: fields.climbSpeedKts ?? profile.climbSpeedKts,
      climbRateFpm: fields.climbRateFpm ?? profile.climbRateFpm,
      descentSpeedKts: fields.descentSpeedKts ?? profile.descentSpeedKts,
      descentRateFpm: fields.descentRateFpm ?? profile.descentRateFpm,
      stations: stations ?? (profile.stations.length > 0 ? profile.stations : null),
    };
    const completeness = computeDataCompleteness(merged);

    const updated = await this.prisma.aircraftProfile.update({
      where: { id: profile.id },
      data: {
        ...fields,
        ...(stations !== undefined
          ? { stations: { deleteMany: {}, create: stations.map(toStationCreate) } }
          : {}),
        dataCompleteness: completeness,
      },
      include: { stations: true },
    });
    void this.activity.log('aircraft_profile.updated', userId, { profileId: id });
    return toUserProfile(updated);
  }

  async remove(id: string, userId: string): Promise<void> {
    const profile = await this.findOneOrFail(id, userId);
    await this.prisma.aircraftProfile.delete({ where: { id: profile.id } });
    void this.activity.log('aircraft_profile.deleted', userId, { profileId: id });
  }

  private async findOneOrFail(id: string, userId: string): Promise<AircraftProfileWithStations> {
    const profile = await this.prisma.aircraftProfile.findUnique({
      where: { id },
      include: { stations: true },
    });
    if (!profile) {
      throw new NotFoundException(`Aircraft profile ${id} not found`);
    }
    if (profile.userId !== userId) {
      throw new ForbiddenException();
    }
    return profile;
  }
}

export function baseFields(profile: AircraftProfileWithStations): AircraftBaseFields {
  return {
    id: profile.id,
    name: profile.name,
    icaoType: profile.icaoType,
    manufacturer: profile.manufacturer,
    model: profile.model,
    emptyWeightKg: profile.emptyWeightKg,
    mtowKg: profile.mtowKg,
    fuelCapacityL: profile.fuelCapacityL,
    fuelBurnLph: profile.fuelBurnLph,
    cruiseSpeedKts: profile.cruiseSpeedKts,
    climbSpeedKts: profile.climbSpeedKts,
    climbRateFpm: profile.climbRateFpm,
    descentSpeedKts: profile.descentSpeedKts,
    descentRateFpm: profile.descentRateFpm,
    stations: profile.stations.length > 0 ? profile.stations.map(mapStation) : null,
    source: (profile.source as EnrichmentSource | null) ?? null,
    dataCompleteness: (profile.dataCompleteness as DataCompleteness) || 'skeleton',
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function toCatalogEntry(profile: AircraftProfileWithStations): AircraftCatalogEntry {
  return { ...baseFields(profile), isTemplate: true as const };
}

export function toUserProfile(profile: AircraftProfileWithStations): UserAircraftProfile {
  return { ...baseFields(profile), isTemplate: false as const, isShared: profile.isShared, clonedFromId: profile.clonedFromId };
}
