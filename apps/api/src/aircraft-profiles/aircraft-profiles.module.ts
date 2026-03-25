import { Module } from '@nestjs/common';

import { AircraftProfilesController } from './aircraft-profiles.controller';
import { AircraftProfilesService } from './aircraft-profiles.service';

@Module({
  controllers: [AircraftProfilesController],
  providers: [AircraftProfilesService],
  exports: [AircraftProfilesService],
})
export class AircraftProfilesModule {}
