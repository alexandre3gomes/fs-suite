import { Module } from '@nestjs/common';

import { PtVfrController } from './pt-vfr.controller';
import { PtVfrService } from './pt-vfr.service';

@Module({
  controllers: [PtVfrController],
  providers: [PtVfrService],
  exports: [PtVfrService],
})
export class PtVfrModule {}
