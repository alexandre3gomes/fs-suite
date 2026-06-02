import { Module } from '@nestjs/common';

import { EmailTokenService } from './email-token.service';
import { EmailController } from './email.controller';
import { MailPreviewController } from './mail-preview.controller';
import { MailerService } from './mailer.service';

// Serves the LGPD one-click unsubscribe + its HMAC token service, the central
// MailerService (sends via Resend in prod, captures for the dev preview inbox
// outside prod), and the dev-only mail preview inbox.
@Module({
  controllers: [EmailController, MailPreviewController],
  providers: [EmailTokenService, MailerService],
  exports: [EmailTokenService, MailerService],
})
export class EmailModule {}
