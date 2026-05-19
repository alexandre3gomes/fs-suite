import { Module } from '@nestjs/common';

import { ReaNavigationService } from './rea-navigation.service';
import { ReaController } from './rea.controller';
import { ReaService } from './rea.service';

@Module({
  controllers: [ReaController],
  providers: [ReaService, ReaNavigationService],
  exports: [ReaService, ReaNavigationService],
})
export class ReaModule {}
