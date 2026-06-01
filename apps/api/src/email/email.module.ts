import { Module } from '@nestjs/common';

import { EmailTokenService } from './email-token.service';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';

@Module({
  controllers: [EmailController],
  providers: [EmailTokenService, EmailService],
  exports: [EmailTokenService, EmailService],
})
export class EmailModule {}
