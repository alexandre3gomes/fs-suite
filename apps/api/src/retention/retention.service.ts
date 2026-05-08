import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Runs daily at 02:00 UTC — purges expired sessions and old activity logs. */
  @Cron('0 2 * * *', { timeZone: 'UTC' })
  async handleRetention(): Promise<void> {
    await Promise.all([
      this.purgeExpiredSessions(),
      this.purgeOldActivityLogs(),
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
}
