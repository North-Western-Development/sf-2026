import type { FastifyInstance } from 'fastify';

/**
 * Text messages (phone verification). With TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
 * TWILIO_FROM set, they go through Twilio. Without them phone verification is switched off,
 * except that development and tests can set SMS_DEV_OUTBOX=true to keep texts in a Redis
 * outbox (dev:sms) like the mail outbox.
 */
export const smsConfigured = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
const devOutbox = () => process.env.NODE_ENV !== 'production' && process.env.SMS_DEV_OUTBOX === 'true';
export const smsAvailable = () => smsConfigured() || devOutbox();

export async function sendSms(app: FastifyInstance, to: string, body: string): Promise<void> {
  if (smsConfigured()) {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`SMS provider refused the message (${res.status})`);
    return;
  }
  if (!devOutbox()) throw new Error('Text messages are not set up on this server');
  app.log.info({ to, body }, '[SMS] development outbox');
  const redis = (app as any).redis;
  if (redis?.status === 'ready') {
    await redis.lpush('dev:sms', JSON.stringify({ to, body, at: new Date().toISOString() })).catch(() => {});
    await redis.ltrim('dev:sms', 0, 49).catch(() => {});
  }
}
