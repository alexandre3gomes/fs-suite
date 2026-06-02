import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

import { ResendAudienceService } from './resend-audience.service';

@ApiTags('admin')
@Controller('admin/audience')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AudienceAdminController {
  constructor(
    private readonly audience: ResendAudienceService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('sync')
  @ApiOperation({ summary: 'Backfill/reconcile all active users into the Resend audience' })
  sync(): Promise<{ total: number; ok: number; failed: number }> {
    return this.audience.backfillAll(this.prisma);
  }
}
