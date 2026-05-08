import { Module } from '@nestjs/common';

import { VfrFlightPlansController } from './vfr-flight-plans.controller';
import { VfrFlightPlansService } from './vfr-flight-plans.service';

@Module({
  controllers: [VfrFlightPlansController],
  providers: [VfrFlightPlansService],
  exports: [VfrFlightPlansService],
})
export class VfrFlightPlansModule {}
