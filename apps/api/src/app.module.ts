import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { ActivityModule } from './activity/activity.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 60,
      },
    ]),
    PrismaModule,
    ActivityModule,
    AuthModule,
    UsersModule,
    // Future modules: AirportsModule, FlightPlansModule, IntegrationsModule
  ],
  providers: [
    // Apply rate limiting globally; auth endpoints override with stricter limit via @Throttle
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
