import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { getAdminRecipients } from '../auth/admin-recipients';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface MetricsSnapshot {
  snapshot_at: string;
  database: {
    size_bytes: number;
  };
  users: {
    total: number;
    new_7d: number;
    active_7d: number;
  };
  plans: {
    total: number;
    new_7d: number;
  };
  sessions: {
    active: number;
  };
  activity: {
    events_24h: number;
    events_7d: number;
  };
  ai_validations_7d: number;
  chart_overlays: number;
  redis: {
    used_memory_bytes: number;
    total_keys: number;
  };
  // Effective admin emails (persisted User.isAdmin ∪ ADMIN_EMAILS bootstrap),
  // deduped lowercase. Consumed by metrics-digest.yml to address the digest
  // email — operational mail to admins, so marketing consent does not apply.
  admin_recipients: string[];
}

@ApiTags('admin')
@Controller('admin')
@SkipThrottle()
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private parseUsedMemory(info: string): number {
    const match = info.match(/^used_memory:(\d+)/m);
    return match ? Number(match[1]) : 0;
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Operational metrics snapshot (cron-only, header-token auth)' })
  async metrics(@Headers('x-admin-token') token?: string): Promise<MetricsSnapshot> {
    const expected = process.env['ADMIN_METRICS_TOKEN'];
    if (!expected) {
      throw new InternalServerErrorException('ADMIN_METRICS_TOKEN not configured');
    }
    if (!token || token !== expected) {
      throw new ForbiddenException();
    }

    const now = new Date();
    const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const day1 = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      sizeRows,
      usersTotal,
      usersNew7d,
      activeUserRows,
      plansTotal,
      plansNew7d,
      sessionsActive,
      activity24h,
      activity7d,
      aiValidations7d,
      chartOverlays,
      redisInfo,
      redisKeys,
      adminRecipients,
    ] = await Promise.all([
      this.prisma.$queryRaw<{ size: bigint }[]>`
        SELECT pg_database_size(current_database())::bigint AS size
      `,
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: day7 } } }),
      this.prisma.activityLog.findMany({
        where: { createdAt: { gte: day7 }, userId: { not: null } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.prisma.flightPlan.count(),
      this.prisma.flightPlan.count({ where: { createdAt: { gte: day7 } } }),
      this.prisma.session.count({ where: { expiresAt: { gte: now } } }),
      this.prisma.activityLog.count({ where: { createdAt: { gte: day1 } } }),
      this.prisma.activityLog.count({ where: { createdAt: { gte: day7 } } }),
      this.prisma.activityLog.count({
        where: { createdAt: { gte: day7 }, action: { startsWith: 'ai_validation' } },
      }),
      this.prisma.aerodromeChartOverlay.count(),
      this.redis.getClient().info('memory'),
      this.redis.getClient().dbSize(),
      getAdminRecipients(this.prisma),
    ]);

    return {
      snapshot_at: now.toISOString(),
      database: {
        size_bytes: Number(sizeRows[0]?.size ?? 0n),
      },
      users: {
        total: usersTotal,
        new_7d: usersNew7d,
        active_7d: activeUserRows.length,
      },
      plans: {
        total: plansTotal,
        new_7d: plansNew7d,
      },
      sessions: {
        active: sessionsActive,
      },
      activity: {
        events_24h: activity24h,
        events_7d: activity7d,
      },
      ai_validations_7d: aiValidations7d,
      chart_overlays: chartOverlays,
      redis: {
        used_memory_bytes: this.parseUsedMemory(redisInfo),
        total_keys: Number(redisKeys),
      },
      admin_recipients: adminRecipients,
    };
  }
}
