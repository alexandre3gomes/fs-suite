import { Injectable } from '@nestjs/common';
import type { Airport } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const CACHE_TTL_SECONDS = 3600; // 1 hour per spec §13
const MAX_RESULTS = 20;

@Injectable()
export class AirportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async search(query: string): Promise<Airport[]> {
    const normalized = query.trim().toLowerCase();
    if (normalized.length < 2) return [];

    // Check Redis cache
    const cacheKey = `airports:search:${normalized}`;
    const client = this.redis.getClient();
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached) as Airport[];
    }

    // Exact ICAO match first (4-letter code)
    const isIcaoQuery = /^[A-Za-z]{3,4}$/.test(normalized);
    let results: Airport[];

    if (isIcaoQuery) {
      results = await this.prisma.$queryRaw<Airport[]>`
        SELECT "icao", "iata", "name", "city", "country", "latitude", "longitude", "elevation"
        FROM "Airport"
        WHERE UPPER("icao") = UPPER(${query.trim()})
        LIMIT 1
      `;
      if (results.length === 0) {
        results = await this.trigramSearch(normalized);
      }
    } else {
      results = await this.trigramSearch(normalized);
    }

    // Cache results
    if (results.length > 0) {
      await client.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(results)).catch(() => {});
    }

    return results;
  }

  async findByIcao(icao: string): Promise<Airport | null> {
    return this.prisma.airport.findUnique({
      where: { icao: icao.toUpperCase() },
    });
  }

  private async trigramSearch(query: string): Promise<Airport[]> {
    return this.prisma.$queryRaw<Airport[]>`
      SELECT "icao", "iata", "name", "city", "country", "latitude", "longitude", "elevation"
      FROM "Airport"
      WHERE "icao" % ${query} OR "name" % ${query}
      ORDER BY GREATEST(similarity("icao", ${query}), similarity("name", ${query})) DESC
      LIMIT ${MAX_RESULTS}
    `;
  }
}
