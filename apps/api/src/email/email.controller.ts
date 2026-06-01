import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';

import { EmailTokenService } from './email-token.service';

@ApiExcludeController()
@Controller('email')
export class EmailController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: EmailTokenService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * One-click unsubscribe (LGPD). Public — auth comes from the HMAC token.
   * Always renders a friendly page (never leaks whether a user exists).
   */
  @Get('unsubscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribe(@Query('u') userId?: string, @Query('t') token?: string): Promise<string> {
    if (!userId || !token || !this.tokens.verify(userId, token)) {
      return this.page(
        'Link inválido',
        'Não foi possível confirmar este link de descadastro. Você pode ajustar suas preferências de email a qualquer momento dentro do app, no seu perfil.',
      );
    }

    // Idempotent: flips to false and stamps the moment; re-clicks are harmless.
    const result = await this.prisma.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: { marketingEmailConsent: false, marketingEmailConsentUpdatedAt: new Date() },
    });

    if (result.count > 0) {
      void this.activity.log('email.consent.opt_out', userId, { source: 'email_link' });
    }

    return this.page(
      'Descadastro confirmado',
      'Você não receberá mais emails de novidades do FS Suite. Mudou de ideia? É só reativar em Perfil → Receber novidades por email.',
    );
  }

  private page(title: string, message: string): string {
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — FS Suite</title>
</head>
<body style="margin:0;background:#0b1320;color:#e7edf5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:64px 24px;text-align:center;">
    <div style="font-size:13px;letter-spacing:2px;color:#5b9bd5;text-transform:uppercase;margin-bottom:24px;">FS Suite</div>
    <h1 style="font-size:22px;margin:0 0 12px;">${title}</h1>
    <p style="font-size:15px;line-height:1.6;color:#9fb0c3;margin:0;">${message}</p>
  </div>
</body>
</html>`;
  }
}
