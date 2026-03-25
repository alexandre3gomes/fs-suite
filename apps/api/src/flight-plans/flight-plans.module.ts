import { Module } from '@nestjs/common';

import { FlightPlansController } from './flight-plans.controller';
import { FlightPlansService } from './flight-plans.service';

@Module({
  controllers: [FlightPlansController],
  providers: [FlightPlansService],
  exports: [FlightPlansService],
})
export class FlightPlansModule {}
