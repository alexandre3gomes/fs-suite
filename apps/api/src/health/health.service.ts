import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  db: boolean;
  redis: boolean;
  uptime: number;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthStatus> {
    const [db, redis] = await Promise.all([
      this.checkDatabase(),
      this.redis.ping(),
    ]);

    const status: HealthStatus = {
      status: db && redis ? 'ok' : 'degraded',
      db,
      redis,
      uptime: process.uptime(),
    };

    if (!db || !redis) {
      throw new ServiceUnavailableException(status);
    }

    return status;
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
