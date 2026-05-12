import { Module } from '@nestjs/common';

import { AiValidationIntegrationModule } from './ai-validation/ai-validation-integration.module';
import { SimBriefModule } from './simbrief/simbrief.module';
import { SkyVectorModule } from './skyvector/skyvector.module';

@Module({
  imports: [AiValidationIntegrationModule, SimBriefModule, SkyVectorModule],
})
export class IntegrationsModule {}
