import { Module } from '@nestjs/common';

import { ReaController } from './rea.controller';
import { ReaService } from './rea.service';

@Module({
  controllers: [ReaController],
  providers: [ReaService],
  exports: [ReaService],
})
export class ReaModule {}
