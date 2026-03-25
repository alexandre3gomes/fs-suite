import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    action: string,
    userId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.activityLog.create({
      data: {
        action,
        userId: userId ?? null,
        // metadata must not contain PII beyond userId — validated at call sites
        metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }
}
