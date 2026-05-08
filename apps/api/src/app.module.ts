import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { ActivityModule } from './activity/activity.module';
import { AircraftProfilesModule } from './aircraft-profiles/aircraft-profiles.module';
import { AirportsModule } from './airports/airports.module';
import { AuthModule } from './auth/auth.module';
import { SentryExceptionFilter } from './common/filters/sentry-exception.filter';
import { FlightPlansModule } from './flight-plans/flight-plans.module';
import { HealthModule } from './health/health.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReaModule } from './rea/rea.module';
import { RedisModule } from './redis/redis.module';
import { RetentionModule } from './retention/retention.module';
import { UsersModule } from './users/users.module';
import { VfrFlightPlansModule } from './vfr-flight-plans/vfr-flight-plans.module';
import { WeatherModule } from './weather/weather.module';

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
    ScheduleModule.forRoot(),
    PrismaModule,
    ReaModule,
    RedisModule,
    ActivityModule,
    AircraftProfilesModule,
    AirportsModule,
    AuthModule,
    FlightPlansModule,
    HealthModule,
    IntegrationsModule,
    RetentionModule,
    UsersModule,
    VfrFlightPlansModule,
    WeatherModule,
  ],
  providers: [
    // Apply rate limiting globally; auth endpoints override with stricter limit via @Throttle
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Capture unhandled exceptions (5xx) to Sentry before returning the HTTP response
    { provide: APP_FILTER, useClass: SentryExceptionFilter },
  ],
})
export class AppModule {}
