import * as crypto from 'crypto';

import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { ActivityService } from '../activity/activity.service';
import { Public } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

interface ResendEvent {
  type: string;
  data?: {
    email?: string;
    to?: string[] | string;
    unsubscribed?: boolean;
  };
}

/**
 * Receives Resend (Svix-signed) webhooks so audience-side changes flow back into
 * our DB — keeping `User.marketingEmailConsent` correct when a user unsubscribes
 * via a broadcast link or is auto-unsubscribed on a spam complaint. This handler
 * only writes the DB; it never pushes back to Resend (no sync loop).
 */
@ApiExcludeController()
@Controller('email')
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  @Public()
  @SkipThrottle()
  @Post('webhooks/resend')
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') svixId?: string,
    @Headers('svix-timestamp') svixTimestamp?: string,
    @Headers('svix-signature') svixSignature?: string,
  ): Promise<{ received: boolean }> {
    const secret = this.config.get<string>('RESEND_WEBHOOK_SECRET');
    const raw = req.rawBody;
    if (!secret || !raw) {
      throw new UnauthorizedException();
    }
    if (!this.verify(secret, raw, svixId, svixTimestamp, svixSignature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let event: ResendEvent;
    try {
      event = JSON.parse(raw.toString('utf8')) as ResendEvent;
    } catch {
      throw new UnauthorizedException('Invalid payload');
    }

    if (event.type === 'contact.updated' && event.data?.email) {
      await this.setConsent(event.data.email, !event.data.unsubscribed, event.type);
    } else if (event.type === 'email.complained') {
      const recipients = Array.isArray(event.data?.to)
        ? event.data!.to
        : event.data?.to
          ? [event.data.to]
          : [];
      for (const email of recipients) {
        await this.setConsent(email, false, event.type);
      }
    }

    return { received: true };
  }

  /** Mirror the consent value into the DB (idempotent). Never calls Resend. */
  private async setConsent(email: string, consent: boolean, eventType: string): Promise<void> {
    const result = await this.prisma.user.updateMany({
      where: { email, deletedAt: null },
      data: { marketingEmailConsent: consent, marketingEmailConsentUpdatedAt: new Date() },
    });
    if (result.count > 0) {
      const user = await this.prisma.user.findFirst({ where: { email }, select: { id: true } });
      void this.activity.log('email.consent.resend_sync', user?.id, { event: eventType, consent });
    }
  }

  /** Svix signature verification (HMAC-SHA256 over `id.timestamp.body`). */
  private verify(
    secret: string,
    body: Buffer,
    id?: string,
    timestamp?: string,
    signatureHeader?: string,
  ): boolean {
    if (!id || !timestamp || !signatureHeader) return false;
    // Reject stale deliveries (replay protection): 5-minute tolerance.
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > 300) return false;

    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const signed = `${id}.${timestamp}.${body.toString('utf8')}`;
    const expected = crypto.createHmac('sha256', secretBytes).update(signed).digest('base64');

    // Header is space-separated "v1,<sig> v1,<sig2>".
    const provided = signatureHeader
      .split(' ')
      .map((part) => part.split(',')[1])
      .filter((s): s is string => Boolean(s));

    const expectedBuf = Buffer.from(expected);
    return provided.some((sig) => {
      const sigBuf = Buffer.from(sig);
      return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
    });
  }
}
