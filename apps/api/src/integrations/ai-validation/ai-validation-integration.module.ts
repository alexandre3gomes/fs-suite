import { Module } from '@nestjs/common';

import { EncryptionModule } from '../../common/encryption/encryption.module';

import { AiValidationIntegrationController } from './ai-validation-integration.controller';
import { AiValidationIntegrationService } from './ai-validation-integration.service';

@Module({
  imports: [EncryptionModule],
  controllers: [AiValidationIntegrationController],
  providers: [AiValidationIntegrationService],
  exports: [AiValidationIntegrationService],
})
export class AiValidationIntegrationModule {}
