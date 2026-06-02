import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';

import { Public } from '../common/guards/jwt-auth.guard';

import type { CapturedEmail } from './mailer.service';
import { MailerService } from './mailer.service';

const MAX_LABEL = 50;

function esc(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Dev-only email preview inbox. Renders the emails captured by MailerService
 * (which only captures outside production). Always returns 404 in production as
 * a second safety net. Public so it opens straight in a browser during dev.
 */
@ApiExcludeController()
@Controller('dev/emails')
export class MailPreviewController {
  constructor(
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  private assertDev(): void {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new NotFoundException();
    }
  }

  @Public()
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  // Dev-only viewer: relax helmet's CSP so the email's inline styles and remote
  // logo render in the iframe (real emails aren't subject to our CSP at all).
  @Header(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' data: blob: https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline';",
  )
  list(): string {
    this.assertDev();
    const emails = this.mailer.list();
    const rows = emails
      .map(
        (e: CapturedEmail) => `
        <tr>
          <td style="white-space:nowrap;color:#64748b;font-size:12px;">${esc(
            new Date(e.receivedAt).toLocaleString(),
          )}</td>
          <td style="font-size:13px;">${esc(e.to.join(', '))}</td>
          <td style="font-size:13px;"><a href="/v1/dev/emails/${e.id}" style="color:#2b6cb0;text-decoration:none;">${esc(
            e.subject,
          )}</a></td>
        </tr>`,
      )
      .join('');

    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
<title>Dev mailbox — FS Suite</title></head>
<body style="margin:0;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2a37;">
  <div style="max-width:820px;margin:0 auto;padding:32px 24px;">
    <div style="font-size:12px;letter-spacing:2px;color:#2b6cb0;text-transform:uppercase;">FS Suite · dev mailbox</div>
    <h1 style="font-size:20px;margin:6px 0 4px;">E-mails capturados (não enviados)</h1>
    <p style="color:#64748b;font-size:13px;margin:0 0 20px;">Fora de produção, todo e-mail é capturado aqui em vez de enviado. ${
      emails.length
    } na memória (máx. ${MAX_LABEL}).</p>
    ${
      emails.length === 0
        ? '<p style="color:#94a3b8;">Nenhum e-mail ainda. Dispare um (ex.: responder um feedback) e recarregue.</p>'
        : `<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <thead><tr style="background:#f1f5f9;text-align:left;">
          <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#64748b;">Quando</th>
          <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#64748b;">Para</th>
          <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#64748b;">Assunto</th>
        </tr></thead>
        <tbody>${rows.replace(/<tr>/g, '<tr style="border-top:1px solid #f1f5f9;">')}</tbody>
      </table>`
    }
  </div>
</body></html>`;
  }

  @Public()
  @Get(':id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' data: blob: https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline';",
  )
  view(@Param('id') id: string): string {
    this.assertDev();
    const email = this.mailer.get(id);
    if (!email) throw new NotFoundException('Email not found in dev inbox');

    // Render metadata header + the email's own HTML inside an iframe (srcdoc) so
    // the email's styles are isolated and you see exactly what would be sent.
    const meta = (
      [
        ['De', email.from],
        ['Para', email.to.join(', ')],
        ['Responder a', email.replyTo ?? '—'],
        ['Assunto', email.subject],
      ] as [string, string][]
    )
      .map(
        ([k, v]) =>
          `<div style="font-size:13px;margin:2px 0;"><span style="color:#94a3b8;width:96px;display:inline-block;">${k}</span> ${esc(
            v,
          )}</div>`,
      )
      .join('');

    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
<title>${esc(email.subject)} — dev mailbox</title></head>
<body style="margin:0;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2a37;">
  <div style="max-width:820px;margin:0 auto;padding:24px;">
    <a href="/v1/dev/emails" style="color:#2b6cb0;font-size:13px;text-decoration:none;">← Voltar</a>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:12px 0;">${meta}</div>
    <iframe srcdoc="${esc(email.html)}" style="width:100%;height:70vh;border:1px solid #e2e8f0;border-radius:10px;background:#fff;"></iframe>
  </div>
</body></html>`;
  }
}
