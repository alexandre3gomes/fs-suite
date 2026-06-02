import { Module } from '@nestjs/common';

import { EmailModule } from '../email/email.module';

import { FeedbackAdminController } from './feedback-admin.controller';
import { FeedbackAttachmentsService } from './feedback-attachments.service';
import { FeedbackMailerService } from './feedback-mailer.service';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [EmailModule],
  controllers: [FeedbackController, FeedbackAdminController],
  providers: [FeedbackService, FeedbackAttachmentsService, FeedbackMailerService],
})
export class FeedbackModule {}
