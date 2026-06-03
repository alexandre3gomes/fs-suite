import { Module } from '@nestjs/common';

import { VfrLayersController } from './vfr-layers.controller';

@Module({
  controllers: [VfrLayersController],
})
export class VfrLayersModule {}
