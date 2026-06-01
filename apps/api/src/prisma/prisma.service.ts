import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  onModuleInit(): void {
    // Warm up the connection in the BACKGROUND — never block app startup on it.
    // A DB that is unreachable, slow, or over-quota must not crash boot: Cloud
    // Run kills a container that doesn't bind its port within the startup
    // timeout, and Prisma connects lazily on the next query anyway. /health
    // reports DB connectivity. (Previously `await $connect()` rejected during
    // Nest init and the container exited before ever listening.)
    this.$connect().catch((err: unknown) => {
      this.logger.error(
        `Initial database connect failed (will retry on demand): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
