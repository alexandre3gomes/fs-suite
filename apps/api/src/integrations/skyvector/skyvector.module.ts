import { Module } from '@nestjs/common';

import { AirportsModule } from '../../airports/airports.module';

import { SkyVectorController } from './skyvector.controller';
import { SkyVectorService } from './skyvector.service';

@Module({
  imports: [AirportsModule],
  controllers: [SkyVectorController],
  providers: [SkyVectorService],
  exports: [SkyVectorService],
})
export class SkyVectorModule {}
