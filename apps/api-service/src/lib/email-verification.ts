import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq, like, transmitters } from '@subspace/database';
import { emailLayout, emailVerificationEnabled, sendMail } from './mailer.js';
import { linkBase } from './origin.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Mark the account's email unverified and send a link to confirm it. Only a hash of the token
 * is stored, together with its expiry and the address it was sent to, so changing the email
 * again invalidates the old link.
 */
export async function sendVerificationEmail(app: FastifyInstance, user: { id: string; email: string; displayName?: string | null; username: string }, request?: FastifyRequest) {
  const db = (app as any).db;
  if (!emailVerificationEnabled()) {
    await db.update(transmitters).set({ isEmailVerified: true, emailVerificationCode: null }).where(eq(transmitters.id, user.id));
    return;
  }
  const token = randomBytes(32).toString('base64url');
  await db
    .update(transmitters)
    .set({ isEmailVerified: false, emailVerificationCode: `${hash(token)}:${Date.now() + TOKEN_TTL_MS}:${user.email}` })
    .where(eq(transmitters.id, user.id));
  const url = `${linkBase(request)}/verify-email?token=${token}`;
  const { text, html } = emailLayout({
    heading: 'Verify your email address',
    paragraphs: [
      `Hi ${user.displayName || user.username},`,
      'Confirm this is your email address so you can recover your account and get account notices.',
      'The link works for 24 hours.',
    ],
    action: { label: 'Verify Email', url },
    footer: 'If you did not create a Subspace Frequency account or change your email, you can ignore this message.',
  });
  // Sending can be slow or fail; the account works meanwhile and the user can resend.
  void sendMail(app, { to: user.email, subject: 'Verify your Subspace Frequency email', text, html }).catch((err) =>
    app.log.warn({ err: (err as Error).message }, '[Mail] verification email failed')
  );
}

/** Tell the previous address that the account's email was changed. */
export async function sendEmailChangedNotice(app: FastifyInstance, previous: string, user: { username: string; email: string }) {
  const { text, html } = emailLayout({
    heading: 'Your email address was changed',
    paragraphs: [
      `The email address on the Subspace Frequency account ${user.username} was just changed to ${user.email.replace(/^(.).*(@.*)$/, '$1•••$2')}.`,
      'If this was you, there is nothing else to do. If it was not, sign in and change your password right away.',
    ],
  });
  void sendMail(app, { to: previous, subject: 'Your Subspace Frequency email was changed', text, html }).catch((err) =>
    app.log.warn({ err: (err as Error).message }, '[Mail] email-changed notice failed')
  );
}

export type VerifyResult = { ok: true; userId: string } | { ok: false; code: 'TOKEN_INVALID' | 'TOKEN_EXPIRED' };

export async function verifyEmailToken(db: any, token: string): Promise<VerifyResult> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false, code: 'TOKEN_INVALID' };
  const [user] = await db
    .select()
    .from(transmitters)
    .where(like(transmitters.emailVerificationCode, `${hash(token)}:%`))
    .limit(1);
  if (!user) return { ok: false, code: 'TOKEN_INVALID' };
  const [, expires, ...rest] = String(user.emailVerificationCode).split(':');
  const email = rest.join(':');
  if (email !== user.email) return { ok: false, code: 'TOKEN_INVALID' };
  if (Number(expires) < Date.now()) return { ok: false, code: 'TOKEN_EXPIRED' };
  await db.update(transmitters).set({ isEmailVerified: true, emailVerificationCode: null }).where(eq(transmitters.id, user.id));
  return { ok: true, userId: user.id };
}
