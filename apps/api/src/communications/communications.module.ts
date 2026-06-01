import { Module } from '@nestjs/common';

import { EmailModule } from '../email/email.module';
import { SupabaseModule } from '../supabase/supabase.module';

import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';

@Module({
  imports: [SupabaseModule, EmailModule],
  controllers: [CommunicationsController],
  providers: [CommunicationsService],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
