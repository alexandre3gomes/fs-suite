import { randomUUID } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface OutgoingEmail {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
}

export interface CapturedEmail extends OutgoingEmail {
  id: string;
  receivedAt: string;
}

const MAX_CAPTURED = 50;

/**
 * Central email sender. In **production** it sends via Resend. **Outside
 * production** it does NOT send — it captures the message into an in-memory dev
 * inbox (viewable at GET /v1/dev/emails) so the exact HTML can be previewed
 * without sending real mail or incurring cost. Set MAIL_FORCE_SEND=true to send
 * for real from a non-prod env (requires RESEND_API_KEY).
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly resend: Resend | null;
  private readonly previewMode: boolean;
  private readonly captured: CapturedEmail[] = [];

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
    const isProd = config.get<string>('NODE_ENV') === 'production';
    const forceSend = config.get<string>('MAIL_FORCE_SEND') === 'true';
    this.previewMode = !isProd && !forceSend;
    if (this.previewMode) {
      this.logger.log('Mail preview mode ON — emails are captured at /v1/dev/emails, not sent');
    }
  }

  isPreviewMode(): boolean {
    return this.previewMode;
  }

  /** Send (prod) or capture for preview (non-prod). Throws on real send failure. */
  async send(email: OutgoingEmail): Promise<void> {
    if (this.previewMode) {
      this.capture(email);
      this.logger.log(
        `📬 [mail preview] "${email.subject}" → ${email.to.join(', ')} — view at /v1/dev/emails`,
      );
      return;
    }
    if (!this.resend) {
      throw new Error('RESEND_API_KEY not configured — cannot send email');
    }
    const result = await this.resend.emails.send({
      from: email.from,
      to: email.to,
      replyTo: email.replyTo,
      subject: email.subject,
      html: email.html,
    });
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  /** Dev inbox — most recent first. */
  list(): CapturedEmail[] {
    return [...this.captured].reverse();
  }

  get(id: string): CapturedEmail | undefined {
    return this.captured.find((e) => e.id === id);
  }

  private capture(email: OutgoingEmail): void {
    this.captured.push({ ...email, id: randomUUID(), receivedAt: new Date().toISOString() });
    if (this.captured.length > MAX_CAPTURED) this.captured.shift();
  }
}
