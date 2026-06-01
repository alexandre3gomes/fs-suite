import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.client = createClient({ url }) as RedisClientType;

    this.client.on('error', (err: Error) => {
      this.logger.error(`Redis client error: ${err.message}`);
      Sentry.captureException(err, { tags: { service: 'redis' } });
    });
  }

  onModuleInit(): void {
    // Connect in the BACKGROUND — don't block app startup (and the HTTP
    // listener) on Redis reachability. Cloud Run kills a container that doesn't
    // bind its port within the startup timeout; the client retries on its own.
    this.client.connect()
      .then(() => this.logger.log('Redis connected'))
      .catch((err: Error) => this.logger.error(`Initial Redis connect failed (will retry): ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  async ping(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  getClient(): RedisClientType {
    return this.client;
  }
}
