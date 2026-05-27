import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';
import { R2StorageService } from '../r2/r2-storage.service';

// Chart overlays older than this fall out of the cache. ~60 days covers two
// AIRAC cycles, so the in-use cycle plus the previous one are always served
// from cache; anything older is regenerated on demand the next time someone
// asks for it.
const CHART_OVERLAY_RETENTION_DAYS = 60;
// Bound the per-run deletion so a long-paused project doesn't try to delete
// thousands of R2 objects in a single tick.
const CHART_OVERLAY_PURGE_BATCH = 500;

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2StorageService,
  ) {}

  /** Runs daily at 02:00 UTC — purges expired sessions, old activity logs, and stale chart overlays. */
  @Cron('0 2 * * *', { timeZone: 'UTC' })
  async handleRetention(): Promise<void> {
    await Promise.all([
      this.purgeExpiredSessions(),
      this.purgeOldActivityLogs(),
      this.purgeStaleChartOverlays(),
    ]);
  }

  /** Delete sessions where expiresAt < now (spec §5.2: 30-day session lifetime). */
  async purgeExpiredSessions(): Promise<void> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`Purged ${result.count} expired session(s)`);
    }
  }

  /** Delete activity logs older than 12 months (spec §5.2: LGPD retention policy). */
  async purgeOldActivityLogs(): Promise<void> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);

    const result = await this.prisma.activityLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`Purged ${result.count} activity log(s) older than 12 months`);
    }
  }

  /**
   * Delete chart-overlay rasters and DB rows that haven't been touched in
   * roughly two AIRAC cycles. The data is a cache — anything we drop is
   * regenerated on-demand the next time someone projects the chart.
   */
  async purgeStaleChartOverlays(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - CHART_OVERLAY_RETENTION_DAYS);

    const stale = await this.prisma.aerodromeChartOverlay.findMany({
      where: { updatedAt: { lt: cutoff } },
      select: { id: true, imageKey: true },
      take: CHART_OVERLAY_PURGE_BATCH,
    });
    if (stale.length === 0) return;

    await Promise.all(stale.map((row) => this.r2.deleteObject(row.imageKey)));

    const result = await this.prisma.aerodromeChartOverlay.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });
    this.logger.log(
      `Purged ${result.count} chart overlay(s) older than ${CHART_OVERLAY_RETENTION_DAYS} days`,
    );
  }
}
