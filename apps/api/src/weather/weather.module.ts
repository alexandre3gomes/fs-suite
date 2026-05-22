import { Module } from '@nestjs/common';

import { ReaModule } from '../rea/rea.module';

import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';

@Module({
  imports: [ReaModule],
  controllers: [WeatherController],
  providers: [WeatherService],
  exports: [WeatherService],
})
export class WeatherModule {}
