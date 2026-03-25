import { Module } from '@nestjs/common';

import { SimBriefController } from './simbrief.controller';
import { SimBriefService } from './simbrief.service';

@Module({
  controllers: [SimBriefController],
  providers: [SimBriefService],
  exports: [SimBriefService],
})
export class SimBriefModule {}
