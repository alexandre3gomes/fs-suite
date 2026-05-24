import { Module } from '@nestjs/common';

import { AirportsController } from './airports.controller';
import { AirportsService } from './airports.service';
import { ChartOverlaysService } from './chart-overlays.service';
import { ChartsService } from './charts.service';

@Module({
  controllers: [AirportsController],
  providers: [AirportsService, ChartsService, ChartOverlaysService],
  exports: [AirportsService],
})
export class AirportsModule {}
