import { Injectable } from '@nestjs/common';
import type { Airport, Frequency, Runway } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const SEARCH_CACHE_TTL = 3600; // 1 hour
const MAX_RESULTS = 20;
const MAX_MAP_RESULTS = 300;

export type AirportWithRunways = Airport & { runways: Runway[]; frequencies: Frequency[] };

export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

@Injectable()
export class AirportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async search(query: string): Promise<Airport[]> {
    const normalized = query.trim();
    if (normalized.length < 2) return [];

    const cacheKey = `aerodromes:search:${normalized.toLowerCase()}`;
    const client = this.redis.getClient();
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached) as Airport[];
    }

    let results: Airport[];

    // Exact ICAO prefix match (fast path for 2-4 letter queries)
    const isIcaoLike = /^[A-Za-z]{2,4}$/.test(normalized);

    if (isIcaoLike) {
      results = await this.prisma.airport.findMany({
        where: {
          icao: { startsWith: normalized.toUpperCase() },
          type: { not: 'closed' },
        },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
        take: MAX_RESULTS,
      });

      if (results.length < MAX_RESULTS) {
        // Fill with ILIKE name matches
        const existingIcaos = results.map((r) => r.icao);
        const nameMatches = await this.prisma.airport.findMany({
          where: {
            name: { contains: normalized, mode: 'insensitive' },
            icao: { notIn: existingIcaos },
            type: { not: 'closed' },
          },
          orderBy: [{ type: 'asc' }, { name: 'asc' }],
          take: MAX_RESULTS - results.length,
        });
        results = [...results, ...nameMatches];
      }
    } else {
      // Name/city search via ILIKE
      results = await this.prisma.airport.findMany({
        where: {
          OR: [
            { name: { contains: normalized, mode: 'insensitive' } },
            { city: { contains: normalized, mode: 'insensitive' } },
            { icao: { contains: normalized, mode: 'insensitive' } },
          ],
          type: { not: 'closed' },
        },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
        take: MAX_RESULTS,
      });
    }

    if (results.length > 0) {
      await client.setEx(cacheKey, SEARCH_CACHE_TTL, JSON.stringify(results)).catch(() => {});
    }

    return results;
  }

  async findByIcao(icao: string): Promise<AirportWithRunways | null> {
    return this.prisma.airport.findUnique({
      where: { icao: icao.toUpperCase() },
      include: {
        runways: { where: { closed: false }, orderBy: { ident: 'asc' } },
        frequencies: { orderBy: { type: 'asc' } },
      },
    });
  }

  async findByBbox(bounds: MapBounds, types?: string[]): Promise<Omit<Airport, 'raw'>[]> {
    const where: Record<string, unknown> = {
      latitude: { gte: bounds.south, lte: bounds.north },
      longitude: { gte: bounds.west, lte: bounds.east },
    };

    if (types && types.length > 0) {
      where.type = { in: types };
    } else {
      where.type = { not: 'closed' };
    }

    return this.prisma.airport.findMany({
      where,
      select: {
        icao: true,
        iata: true,
        name: true,
        latitude: true,
        longitude: true,
        elevation: true,
        type: true,
        city: true,
        country: true,
      },
      take: MAX_MAP_RESULTS,
    });
  }
}
