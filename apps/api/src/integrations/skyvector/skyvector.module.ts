import { Module } from '@nestjs/common';

import { SkyVectorController } from './skyvector.controller';
import { SkyVectorService } from './skyvector.service';

@Module({
  controllers: [SkyVectorController],
  providers: [SkyVectorService],
  exports: [SkyVectorService],
})
export class SkyVectorModule {}
