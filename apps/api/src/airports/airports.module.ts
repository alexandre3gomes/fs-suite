import { Module } from '@nestjs/common';

import { AirportsController } from './airports.controller';
import { AirportsService } from './airports.service';
import { ChartsService } from './charts.service';

@Module({
  controllers: [AirportsController],
  providers: [AirportsService, ChartsService],
  exports: [AirportsService],
})
export class AirportsModule {}
