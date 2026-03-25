import { BadRequestException, BadGatewayException, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

import type { UpdateSimBriefConnectionDto } from './dto/update-simbrief-connection.dto';

const SIMBRIEF_API_URL = 'https://www.simbrief.com/api/xml.fetcher.php';
const CACHE_TTL_SECONDS = 300; // 5 minutes per spec §13

export interface SimBriefOfpResult {
  ofpId: string;
  originIcao: string;
  destinationIcao: string;
  route: string | null;
  aircraftIcaoType: string | null;
  fuelPlanned: number | null;
  altIcao: string | null;
  flightNumber: string | null;
}

@Injectable()
export class SimBriefService {
  private readonly logger = new Logger(SimBriefService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async saveConnection(userId: string, dto: UpdateSimBriefConnectionDto): Promise<{ pilotId: string }> {
    await this.prisma.integrationConnection.upsert({
      where: { userId_service: { userId, service: 'simbrief' } },
      update: { externalId: dto.pilotId },
      create: { userId, service: 'simbrief', externalId: dto.pilotId },
    });

    return { pilotId: dto.pilotId };
  }

  async getConnection(userId: string): Promise<{ pilotId: string } | null> {
    const conn = await this.prisma.integrationConnection.findUnique({
      where: { userId_service: { userId, service: 'simbrief' } },
    });
    return conn?.externalId ? { pilotId: conn.externalId } : null;
  }

  async fetchOfp(userId: string): Promise<SimBriefOfpResult> {
    const conn = await this.getConnection(userId);
    if (!conn) {
      throw new BadRequestException(
        'No SimBrief pilot ID configured. Please set your pilot ID in your profile settings.',
      );
    }

    // Check Redis cache
    const cacheKey = `simbrief:ofp:${conn.pilotId}`;
    const client = this.redis.getClient();
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached) as SimBriefOfpResult;
    }

    // Fetch from SimBrief API
    const url = `${SIMBRIEF_API_URL}?username=${encodeURIComponent(conn.pilotId)}&json=1`;

    let data: Record<string, unknown>;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`SimBrief API returned ${response.status}`);
      }
      data = (await response.json()) as Record<string, unknown>;
    } catch (err) {
      this.logger.error(`SimBrief API error for pilot ${conn.pilotId}: ${err}`);
      throw new BadGatewayException('SimBrief API is currently unavailable. Please try again later.');
    }

    // Normalize response
    const result = this.normalizeOfp(data);

    // Cache result
    await client.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result)).catch(() => {});

    return result;
  }

  private normalizeOfp(data: Record<string, unknown>): SimBriefOfpResult {
    const params = (data['params'] ?? {}) as Record<string, unknown>;
    const general = (data['general'] ?? {}) as Record<string, unknown>;
    const origin = (data['origin'] ?? {}) as Record<string, unknown>;
    const destination = (data['destination'] ?? {}) as Record<string, unknown>;
    const alternate = (data['alternate'] ?? {}) as Record<string, unknown>;
    const fuel = (data['fuel'] ?? {}) as Record<string, unknown>;
    const aircraft = (data['aircraft'] ?? {}) as Record<string, unknown>;

    return {
      ofpId: String(params['request_id'] ?? general['icao_airline'] ?? ''),
      originIcao: String(origin['icao_code'] ?? ''),
      destinationIcao: String(destination['icao_code'] ?? ''),
      route: (general['route'] as string) ?? null,
      aircraftIcaoType: (aircraft['icaocode'] as string) ?? null,
      fuelPlanned: fuel['plan_ramp'] ? Number(fuel['plan_ramp']) : null,
      altIcao: (alternate['icao_code'] as string) ?? null,
      flightNumber: (general['flight_number'] as string) ?? null,
    };
  }
}
