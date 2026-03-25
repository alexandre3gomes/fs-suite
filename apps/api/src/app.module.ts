import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { ActivityModule } from './activity/activity.module';
import { AircraftProfilesModule } from './aircraft-profiles/aircraft-profiles.module';
import { AirportsModule } from './airports/airports.module';
import { AuthModule } from './auth/auth.module';
import { FlightPlansModule } from './flight-plans/flight-plans.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): object => {
        const isProduction = config.get('NODE_ENV') === 'production';
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', isProduction ? 'info' : 'debug'),
            transport: isProduction
              ? undefined
              : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
            // Exclude health check from request logs to reduce noise
            autoLogging: {
              ignore: (req: { url?: string }) => req.url === '/v1/health',
            },
          },
        };
      },
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 60,
      },
    ]),
    PrismaModule,
    RedisModule,
    ActivityModule,
    AircraftProfilesModule,
    AirportsModule,
    AuthModule,
    FlightPlansModule,
    HealthModule,
    UsersModule,
    // Future modules: IntegrationsModule
  ],
  providers: [
    // Apply rate limiting globally; auth endpoints override with stricter limit via @Throttle
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
