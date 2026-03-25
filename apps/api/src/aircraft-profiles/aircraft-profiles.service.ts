import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AircraftProfile } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import type { CreateAircraftProfileDto } from './dto/create-aircraft-profile.dto';
import type { UpdateAircraftProfileDto } from './dto/update-aircraft-profile.dto';

@Injectable()
export class AircraftProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByUser(userId: string): Promise<AircraftProfile[]> {
    return this.prisma.aircraftProfile.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(userId: string, dto: CreateAircraftProfileDto): Promise<AircraftProfile> {
    return this.prisma.aircraftProfile.create({
      data: { ...dto, userId },
    });
  }

  async update(id: string, userId: string, dto: UpdateAircraftProfileDto): Promise<AircraftProfile> {
    const profile = await this.findOneOrFail(id, userId);
    return this.prisma.aircraftProfile.update({
      where: { id: profile.id },
      data: dto,
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const profile = await this.findOneOrFail(id, userId);
    await this.prisma.aircraftProfile.delete({ where: { id: profile.id } });
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
