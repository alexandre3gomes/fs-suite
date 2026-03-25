import { Module } from '@nestjs/common';

import { SimBriefModule } from './simbrief/simbrief.module';
import { SkyVectorModule } from './skyvector/skyvector.module';

@Module({
  imports: [SimBriefModule, SkyVectorModule],
})
export class IntegrationsModule {}
