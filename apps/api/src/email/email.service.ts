import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommunicationStatus, EmailDeliveryStatus } from '@prisma/client';
import { Resend } from 'resend';

import { isAdminEmail } from '../auth/admin-emails';
import { PrismaService } from '../prisma/prisma.service';

import { renderCommunicationEmail, type TemplateImage } from './email-template';
import { EmailTokenService } from './email-token.service';

export interface SendResult {
  communicationId: string;
  eligible: number;
  alreadySent: number;
  pending: number;
  sent: number;
  failed: number;
  remaining: number;
  dryRun: boolean;
}

// Resend free tier: 100 emails/day. Cap per run; re-running later sends the
// rest (idempotent — already-sent recipients are skipped).
const MAX_PER_RUN = 100;

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly replyTo: string;
  private readonly apiUrl: string;
  private readonly appUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tokens: EmailTokenService,
  ) {
    const key = this.config.get<string>('RESEND_API_KEY');
    this.resend = key ? new Resend(key) : null;
    this.from = this.config.get<string>('EMAIL_FROM', 'FS Suite <novidades@fs-suite.com>');
    this.replyTo = this.config.get<string>('EMAIL_REPLY_TO', 'alexandre@fs-suite.com');
    this.apiUrl = (this.config.get<string>('API_PUBLIC_URL', 'http://localhost:3001')).replace(
      /\/$/,
      '',
    );
    this.appUrl = this.config.get<string>('WEB_ORIGIN', 'https://fs-suite.com');
  }

  isConfigured(): boolean {
    return this.resend !== null;
  }

  private unsubscribeUrl(userId: string): string {
    const t = this.tokens.sign(userId);
    return `${this.apiUrl}/v1/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${t}`;
  }

  /**
   * Send (or dry-run) a communication. Recipients are non-deleted users that
   * haven't already received it. Idempotent and capped at MAX_PER_RUN per call.
   *
   * - Normal mode: all users with marketingEmailConsent.
   * - adminOnly mode (internal test): only ADMIN_EMAILS, ignoring consent — a
   *   safe way to send a real test to yourself before the broad blast.
   */
  async sendCommunication(
    id: string,
    opts: { dryRun: boolean; adminOnly?: boolean },
  ): Promise<SendResult> {
    const { dryRun, adminOnly = false } = opts;
    const comm = await this.prisma.communication.findUnique({ where: { id } });
    if (!comm) throw new NotFoundException('Communication not found');

    const allActive = await this.prisma.user.findMany({
      where: adminOnly ? { deletedAt: null } : { marketingEmailConsent: true, deletedAt: null },
      select: { id: true, email: true },
    });
    const recipients = adminOnly ? allActive.filter((u) => isAdminEmail(u.email)) : allActive;
    const delivered = await this.prisma.emailDelivery.findMany({
      where: { communicationId: id, status: EmailDeliveryStatus.SENT },
      select: { userId: true },
    });
    const sentSet = new Set(delivered.map((d) => d.userId));
    const pending = recipients.filter((u) => !sentSet.has(u.id));

    const base = {
      communicationId: id,
      eligible: recipients.length,
      alreadySent: sentSet.size,
      pending: pending.length,
    };

    if (dryRun) {
      return { ...base, sent: 0, failed: 0, remaining: pending.length, dryRun: true };
    }

    if (!this.resend) {
      throw new BadRequestException('Email provider not configured (RESEND_API_KEY)');
    }

    const batch = pending.slice(0, MAX_PER_RUN);
    const remaining = pending.length - batch.length;
    if (batch.length === 0) {
      return { ...base, sent: 0, failed: 0, remaining: 0, dryRun: false };
    }

    const images: TemplateImage[] = (comm.images as unknown as TemplateImage[]) ?? [];
    const payloads = batch.map((u) => ({
      from: this.from,
      to: u.email,
      replyTo: this.replyTo,
      subject: comm.subject,
      html: renderCommunicationEmail({
        subject: comm.subject,
        bodyMarkdown: comm.body,
        images,
        unsubscribeUrl: this.unsubscribeUrl(u.id),
        appUrl: this.appUrl,
      }),
    }));

    let sent = 0;
    let failed = 0;
    try {
      const res = await this.resend.batch.send(payloads);
      if (res.error) {
        throw new Error(res.error.message);
      }
      const ids = res.data?.data ?? [];
      await Promise.all(
        batch.map((u, i) =>
          this.recordDelivery(id, u.id, EmailDeliveryStatus.SENT, ids[i]?.id ?? null, null),
        ),
      );
      sent = batch.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(`Batch send failed for communication ${id}: ${message}`);
      await Promise.all(
        batch.map((u) =>
          this.recordDelivery(id, u.id, EmailDeliveryStatus.FAILED, null, message),
        ),
      );
      failed = batch.length;
    }

    if (sent > 0 && remaining === 0) {
      await this.prisma.communication.update({
        where: { id },
        data: { status: CommunicationStatus.SENT, sentAt: new Date() },
      });
    }

    return { ...base, sent, failed, remaining, dryRun: false };
  }

  private recordDelivery(
    communicationId: string,
    userId: string,
    status: EmailDeliveryStatus,
    providerId: string | null,
    error: string | null,
  ): Promise<unknown> {
    return this.prisma.emailDelivery.upsert({
      where: { userId_communicationId: { userId, communicationId } },
      create: { communicationId, userId, status, providerId, error },
      update: { status, providerId, error },
    });
  }
}
