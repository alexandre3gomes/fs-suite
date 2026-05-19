import { Module } from '@nestjs/common';

import { WeatherModule } from '../weather/weather.module';

import { FlightPlansController } from './flight-plans.controller';
import { FlightPlansService } from './flight-plans.service';

@Module({
  imports: [WeatherModule],
  controllers: [FlightPlansController],
  providers: [FlightPlansService],
  exports: [FlightPlansService],
})
export class FlightPlansModule {}
