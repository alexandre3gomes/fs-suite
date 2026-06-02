import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Feedback, User } from '@prisma/client';

import { getAdminRecipients } from '../auth/admin-recipients';
import { MailerService } from '../email/mailer.service';
import { PrismaService } from '../prisma/prisma.service';

const TYPE_LABELS: Record<string, string> = {
  BUG_REPORT: 'Reporte de erro',
  SUGGESTION: 'Sugestão',
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraphs(text: string): string {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;line-height:1.6;">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

/**
 * Builds the two feedback emails (operational/transactional — no
 * marketing-consent gate, no unsubscribe link) and hands them to the central
 * MailerService (sends via Resend in prod, captures for the dev inbox otherwise):
 *   1. notifyAdmins  — new feedback landed (best-effort, never blocks the user).
 *   2. sendReply     — admin's reply to the reporter (throws on failure so the
 *                      admin learns it didn't go out).
 *
 * The signature footer is per-replier: the name comes from the admin who
 * replied; the title is "Founder & Lead Engineer | FS Suite" for the founder
 * account and "FS Suite administrator" for any other admin. Logo + GitHub are
 * shared (env-overridable).
 */
@Injectable()
export class FeedbackMailerService {
  private readonly logger = new Logger(FeedbackMailerService.name);
  private readonly from: string;
  private readonly replyTo: string;
  private readonly appBaseUrl: string;
  private readonly logoUrl: string;
  private readonly siteUrl: string;
  private readonly github: string;
  private readonly founderEmail: string;
  private readonly founderTitle: string;
  private readonly adminTitle: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {
    this.from = this.config.get<string>('FEEDBACK_EMAIL_FROM', 'FS Suite <feedback@fs-suite.com>');
    this.replyTo = this.config.get<string>('FEEDBACK_EMAIL_REPLY_TO', 'feedback@fs-suite.com');
    this.appBaseUrl = (
      this.config.get<string>('WEB_ORIGIN') ?? 'https://fs-suite.com'
    ).replace(/\/+$/, '');

    // Signature footer config — same identity as the metrics digest. Title is
    // resolved per-replier (see titleFor); the rest is shared + env-overridable.
    this.logoUrl = this.config.get<string>(
      'FEEDBACK_SIGNATURE_LOGO_URL',
      'https://kottmfuncqyzwtweoquw.supabase.co/storage/v1/object/public/communications/email/fs-suite-logo.png',
    );
    this.siteUrl = this.config.get<string>('FEEDBACK_SIGNATURE_SITE_URL', 'https://fs-suite.com');
    this.github = this.config.get<string>(
      'FEEDBACK_SIGNATURE_GITHUB',
      'https://github.com/alexandre3gomes/fs-suite/',
    );
    this.founderEmail = this.config
      .get<string>('FEEDBACK_SIGNATURE_FOUNDER_EMAIL', 'alexandre3gomes@gmail.com')
      .trim()
      .toLowerCase();
    this.founderTitle = this.config.get<string>(
      'FEEDBACK_SIGNATURE_FOUNDER_TITLE',
      'Founder & Lead Engineer | FS Suite',
    );
    this.adminTitle = this.config.get<string>(
      'FEEDBACK_SIGNATURE_ADMIN_TITLE',
      'Administration team | FS Suite',
    );
  }

  /** Title rule: founder account keeps its title; every other admin is a generic admin. */
  private titleFor(email: string): string {
    return email.trim().toLowerCase() === this.founderEmail ? this.founderTitle : this.adminTitle;
  }

  /** Build the signature block. `title` is optional (omitted → no title line). */
  private signatureHtml(name: string, title: string): string {
    return `
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e2e8f0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;padding-right:14px;">
          <a href="${escapeHtml(this.siteUrl)}" target="_blank" style="text-decoration:none;"><img src="${escapeHtml(this.logoUrl)}" alt="FS Suite" width="72" style="display:block;height:auto;border:0;"/></a>
        </td>
        <td style="vertical-align:middle;">
          <div style="color:#1a2433;font-size:14px;font-weight:600;">${escapeHtml(name)}</div>
          ${title ? `<div style="color:#64748b;font-size:12px;">${escapeHtml(title)}</div>` : ''}
          <a href="${escapeHtml(this.github)}" style="color:#2563eb;font-size:12px;text-decoration:none;">${escapeHtml(this.github)}</a>
        </td>
      </tr></table>
    </div>`;
  }

  private shell(title: string, bodyHtml: string, signatureHtml: string): string {
    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="margin:0;background:#f4f6fa;color:#1f2a37;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="font-size:12px;letter-spacing:2px;color:#2b6cb0;text-transform:uppercase;margin-bottom:8px;">FS Suite</div>
    <h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(title)}</h1>
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;font-size:15px;">
      ${bodyHtml}
    </div>
    ${signatureHtml}
  </div>
</body></html>`;
  }

  /** New feedback → all admins. Best-effort: logs and swallows any error. */
  async notifyAdmins(feedback: Feedback, attachmentCount: number): Promise<void> {
    try {
      const to = await getAdminRecipients(this.prisma);
      if (to.length === 0) return;

      const typeLabel = TYPE_LABELS[feedback.type] ?? feedback.type;
      const link = `${this.appBaseUrl}/admin/feedback/${feedback.id}`;
      const body = `
        <p style="margin:0 0 12px;"><strong>${escapeHtml(typeLabel)}</strong> de
        ${escapeHtml(feedback.reporterName)} (${escapeHtml(feedback.reporterEmail)})</p>
        ${paragraphs(feedback.description)}
        ${attachmentCount > 0 ? `<p style="margin:12px 0 0;color:#64748b;">📎 ${attachmentCount} anexo(s)</p>` : ''}
        <p style="margin:20px 0 0;"><a href="${link}" style="color:#2b6cb0;">Abrir no painel admin →</a></p>`;

      // System notification → brand footer (no person).
      await this.mailer.send({
        from: this.from,
        to,
        replyTo: this.replyTo,
        subject: `[FS Suite] Novo ${typeLabel} — ${feedback.reporterName}`,
        html: this.shell('Novo feedback recebido', body, this.signatureHtml('FS Suite', '')),
      });
    } catch (err) {
      this.logger.warn(`Admin feedback notification failed: ${(err as Error).message}`);
    }
  }

  /**
   * Admin reply → the reporter. Signed with the replying admin's name + the
   * title resolved from their email. Throws on failure so the caller can
   * surface it.
   */
  async sendReply(feedback: Feedback, reply: string, admin: User): Promise<void> {
    const body = `
      <p style="margin:0 0 16px;">Olá ${escapeHtml(feedback.reporterName)}, obrigado pelo seu contato.</p>
      ${paragraphs(reply)}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;"/>
      <p style="margin:0 0 8px;color:#64748b;font-size:13px;">Sua mensagem enviada:</p>
      <div style="color:#64748b;font-size:13px;">${paragraphs(feedback.description)}</div>`;

    const signature = this.signatureHtml(admin.name, this.titleFor(admin.email));
    await this.mailer.send({
      from: this.from,
      to: [feedback.reporterEmail],
      replyTo: this.replyTo,
      subject: 'Resposta ao seu feedback — FS Suite',
      html: this.shell('Resposta ao seu feedback', body, signature),
    });
  }
}
