import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export interface TemplateImage {
  url: string;
  caption?: string;
}

export interface TemplateInput {
  subject: string;
  bodyMarkdown: string;
  images: TemplateImage[];
  unsubscribeUrl: string;
  appUrl: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Branded HTML email (cockpit aesthetic). Inline styles only — email clients
 * strip <style>. Body is admin-authored markdown rendered to safe HTML.
 */
export function renderCommunicationEmail(input: TemplateInput): string {
  // markdown-it renders inline `![](url)` to bare <img>; constrain them so
  // pasted screenshots stay responsive inside the email client.
  const bodyHtml = md
    .render(input.bodyMarkdown)
    .replace(
      /<img /g,
      '<img style="display:block;max-width:100%;height:auto;border-radius:8px;border:1px solid #e2e8f0;margin:12px 0;" ',
    );

  const imagesHtml = input.images
    .map(
      (img) => `
      <tr><td style="padding:8px 0;">
        <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.caption ?? '')}" width="536"
             style="display:block;width:100%;max-width:536px;border-radius:8px;border:1px solid #e2e8f0;" />
        ${
          img.caption
            ? `<div style="font-size:12px;color:#64748b;padding-top:6px;text-align:center;">${escapeHtml(img.caption)}</div>`
            : ''
        }
      </td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <!-- header -->
        <tr><td style="background:#0b1320;padding:20px 32px;">
          <span style="color:#5b9bd5;font-size:13px;letter-spacing:3px;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-weight:700;">FS Suite</span>
        </td></tr>
        <!-- content -->
        <tr><td style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
          <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:#0b1320;">${escapeHtml(input.subject)}</h1>
          <div style="font-size:15px;line-height:1.65;color:#334155;">${bodyHtml}</div>
          ${imagesHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">${imagesHtml}</table>` : ''}
          <div style="margin-top:28px;">
            <a href="${escapeHtml(input.appUrl)}" style="display:inline-block;background:#0b1320;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">Abrir o FS Suite</a>
          </div>
        </td></tr>
        <!-- footer -->
        <tr><td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <p style="font-size:12px;line-height:1.6;color:#94a3b8;margin:0;">
            Você recebe este email porque tem uma conta no FS Suite.
            <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#5b9bd5;">Descadastrar-se</a> dos emails de novidades.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
