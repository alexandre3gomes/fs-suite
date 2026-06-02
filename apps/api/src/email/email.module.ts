import { Module } from '@nestjs/common';

import { AudienceAdminController } from './audience-admin.controller';
import { EmailTokenService } from './email-token.service';
import { EmailController } from './email.controller';
import { MailPreviewController } from './mail-preview.controller';
import { MailerService } from './mailer.service';
import { ResendAudienceService } from './resend-audience.service';
import { ResendWebhookController } from './resend-webhook.controller';

// Email surface: LGPD one-click unsubscribe + HMAC token service, the central
// MailerService (Resend in prod / dev preview inbox otherwise), the dev mail
// preview inbox, the Resend marketing-audience sync (+ admin backfill), and the
// Resend webhook that reflects audience-side unsubscribes back into our DB.
@Module({
  controllers: [
    EmailController,
    MailPreviewController,
    ResendWebhookController,
    AudienceAdminController,
  ],
  providers: [EmailTokenService, MailerService, ResendAudienceService],
  exports: [EmailTokenService, MailerService, ResendAudienceService],
})
export class EmailModule {}
