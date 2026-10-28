import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyInstance } from 'fastify';

/**
 * Outgoing email. With SMTP_HOST set, mail goes through that server. Without it, development
 * and test builds keep a log of what would have been sent (Redis list `dev:outbox`), and
 * production sends nothing: email verification then stays off, since nobody could finish it.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export const smtpConfigured = () => !!process.env.SMTP_HOST;
/** Whether email verification is in force on this instance. */
export const emailVerificationEnabled = () => smtpConfigured() || process.env.NODE_ENV !== 'production';

let cached: { key: string; transport: Transporter } | null = null;
function transport(): Transporter {
  const env = process.env;
  const key = [env.SMTP_HOST, env.SMTP_PORT, env.SMTP_USER, env.SMTP_SECURE].join('|');
  if (cached?.key === key) return cached.transport;
  const port = Number(env.SMTP_PORT || 587);
  const t = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    // Local test sinks have no certificate; real servers negotiate STARTTLS as usual.
    ...(env.NODE_ENV !== 'production' && env.SMTP_INSECURE === 'true' ? { ignoreTLS: true } : {}),
  });
  cached = { key, transport: t };
  return t;
}

export async function sendMail(app: FastifyInstance, mail: Mail): Promise<void> {
  const from = process.env.SMTP_FROM || 'Subspace Frequency <no-reply@subspace.click>';
  if (smtpConfigured()) {
    await transport().sendMail({ from, ...mail });
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    app.log.warn({ to: mail.to, subject: mail.subject }, '[Mail] SMTP is not configured; email not sent');
    return;
  }
  app.log.info({ to: mail.to, subject: mail.subject, text: mail.text }, '[Mail] development outbox');
  const redis = (app as any).redis;
  if (redis?.status === 'ready') {
    await redis.lpush('dev:outbox', JSON.stringify({ ...mail, from, at: new Date().toISOString() })).catch(() => {});
    await redis.ltrim('dev:outbox', 0, 49).catch(() => {});
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A plain, accessible email layout in the app's colours. */
export function emailLayout(opts: { heading: string; paragraphs: string[]; action?: { label: string; url: string }; footer?: string }) {
  const { heading, paragraphs, action, footer } = opts;
  const text = [heading, '', ...paragraphs, ...(action ? ['', `${action.label}: ${action.url}`] : []), ...(footer ? ['', footer] : [])].join('\n');
  // Email clients ignore padding on tables and often drop <body> styles: spacing lives on cells,
  // and the colours are repeated as bgcolor attributes.
  const row = (style: string, inner: string) => `<tr><td style="${style}">${inner}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#030305">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#030305" style="background:#030305"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0D0F16" style="max-width:520px;background:#0D0F16;border-radius:12px">
<tr><td style="padding:32px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#EEF1FA">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${row('font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#3DCBFF;padding-bottom:16px', 'Subspace Frequency')}
${row('font-size:22px;line-height:28px;font-weight:700;color:#EEF1FA;padding-bottom:12px', esc(heading))}
${paragraphs.map((p) => row('font-size:15px;line-height:22px;color:#A4A9C4;padding-bottom:12px', esc(p))).join('\n')}
${
  action
    ? row(
        'padding:12px 0 20px',
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3B8EF2" style="background:#3B8EF2;border-radius:6px"><a href="${esc(action.url)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">${esc(action.label)}</a></td></tr></table>`
      ) + row('font-size:12px;line-height:18px;color:#6D7294;word-break:break-all', `<a href="${esc(action.url)}" style="color:#6D7294">${esc(action.url)}</a>`)
    : ''
}
${footer ? row('font-size:12px;line-height:18px;color:#6D7294;padding-top:20px', esc(footer)) : ''}
</table>
</td></tr></table>
</td></tr></table></body></html>`;
  return { text, html };
}
