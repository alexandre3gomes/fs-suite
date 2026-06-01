import { Module } from '@nestjs/common';

import { EmailTokenService } from './email-token.service';
import { EmailController } from './email.controller';

// Email sending (Resend) was removed with the communications feature. This
// module now only serves the LGPD one-click unsubscribe endpoint and its HMAC
// token service, kept for future user communications.
@Module({
  controllers: [EmailController],
  providers: [EmailTokenService],
  exports: [EmailTokenService],
})
export class EmailModule {}
