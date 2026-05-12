import { Module } from '@nestjs/common';

import { EncryptionModule } from '../common/encryption/encryption.module';

import { AiValidationController } from './ai-validation.controller';
import { AiValidationService } from './ai-validation.service';

@Module({
  imports: [EncryptionModule],
  controllers: [AiValidationController],
  providers: [AiValidationService],
})
export class AiValidationModule {}
