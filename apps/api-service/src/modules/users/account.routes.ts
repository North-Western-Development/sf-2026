import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { and, blockEu, eq, gte, incidentReports, transmissions, transmitters, vaultFiles } from '@subspace/database';
import { isGdprPhone } from '@subspace/constants';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { confirmPassword } from '../../lib/confirm-password.js';
import { sendSms, smsAvailable } from '../../lib/sms.js';
import { codeAttempts, count, countryAllowed, lineTypeCheck, overLimit, vpnCheck, type LimitName } from '../../lib/verification-guard.js';

const hash = (code: string) => createHash('sha256').update(code).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const LIMIT_MESSAGES: Partial<Record<LimitName, string>> = {
  PHONE_VERIFY_PER_USER: 'This account verified a phone number recently. Try again later.',
  PHONE_VERIFY_PER_IP: 'A phone number was verified from this network recently. Try again later.',
  PHONE_CODES_PER_USER: 'Too many codes sent to this account. Try again later.',
  PHONE_CODES_PER_NUMBER: 'Too many codes sent to that number. Try again later.',
  PHONE_CODES_PER_IP: 'Too many codes sent from this network. Try again later.',
};
const E164 = /^\+[1-9]\d{7,14}$/;
const YEAR = 365 * 86_400_000;

/**
 * Account extras (User Settings › My Account):
 *   GET    /users/@me/standing            Account Standing: violations staff acted on, and limits
 *   GET    /users/@me/phone/config        whether phone verification is on here
 *   POST   /users/@me/phone               { phone, password } texts a code to a new number
 *   POST   /users/@me/phone/verify        { code } confirms it
 *   DELETE /users/@me/phone               { password } removes it
 */
export const accountRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  app.get('/users/@me/standing', async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const me = token.transmitterId;
    const [account] = await db.select().from(transmitters).where(eq(transmitters.id, me)).limit(1);
    const since = new Date(Date.now() - YEAR);

    // Reports staff resolved (acted on) about you or something you sent; never who reported.
    const mine = await db.select({ id: transmissions.id }).from(transmissions).where(eq(transmissions.transmitterId, me));
    const ids = new Set(mine.map((t: any) => t.id));
    const resolved = await db
      .select({ id: incidentReports.id, reason: incidentReports.reason, targetType: incidentReports.targetType, targetId: incidentReports.targetId, resolvedAt: incidentReports.resolvedAt })
      .from(incidentReports)
      .where(and(eq(incidentReports.status, 'resolved'), gte(incidentReports.createdAt, since)));
    const violations = resolved
      .filter((r: any) => (r.targetType === 'transmitter' && r.targetId === me) || (r.targetType === 'transmission' && ids.has(r.targetId)))
      .map((r: any) => ({ id: r.id, kind: r.targetType === 'transmission' ? 'transmission' : 'account', reason: r.reason, at: r.resolvedAt }));
    const files = await db
      .select({ id: vaultFiles.id, at: vaultFiles.createdAt })
      .from(vaultFiles)
      .where(and(eq(vaultFiles.transmitterId, me), eq(vaultFiles.isQuarantined, true), gte(vaultFiles.createdAt, since)));
    for (const f of files) violations.push({ id: f.id, kind: 'file', reason: 'illicit_content', at: f.at });

    const status = account?.quarantinedAt ? 'very_limited' : violations.length >= 3 ? 'at_risk' : violations.length ? 'limited' : 'all_good';
    return reply.send({
      status,
      quarantined: account?.quarantinedAt ? { since: account.quarantinedAt, reason: account.quarantineReason } : null,
      violations: violations.sort((a: any, b: any) => +new Date(b.at) - +new Date(a.at)),
    });
  });

  app.get('/users/@me/phone/config', async (_request, reply) => reply.send({ available: smsAvailable() }));

  const refuse = (reply: any, name: LimitName) => reply.status(429).send({ error: LIMIT_MESSAGES[name] ?? 'Try again later.', code: 'PHONE_RATE_LIMITED', limit: name });

  app.post('/users/@me/phone', { schema: { body: { type: 'object', additionalProperties: false, required: ['phone', 'password'], properties: { phone: { type: 'string', maxLength: 20 }, password: { type: 'string' } } } } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    const redis = (app as any).redis;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    if (!smsAvailable()) return reply.status(503).send({ error: 'Phone verification is not available on this server', code: 'SMS_UNAVAILABLE' });
    // The limits live in Redis: without it, nothing is sent rather than everything.
    if (redis?.status !== 'ready') return reply.status(503).send({ error: 'Phone verification is unavailable right now', code: 'SMS_UNAVAILABLE' });
    const body = request.body as { phone: string; password: string };
    const phone = body.phone.replace(/[\s()-]/g, '');
    if (!E164.test(phone)) return reply.status(400).send({ error: 'Enter the number with its country code, like +1 555 010 0199', code: 'INVALID_PHONE' });
    if (!countryAllowed(phone)) return reply.status(400).send({ error: 'Numbers from that country cannot be verified here', code: 'PHONE_COUNTRY_BLOCKED' });
    // BLOCK_EU: no numbers from the EU, the EEA or the UK, where the GDPR applies.
    if (blockEu() && isGdprPhone(phone)) {
      return reply.status(400).send({ error: 'Numbers from the EU, the EEA and the UK cannot be verified here', code: 'PHONE_COUNTRY_BLOCKED' });
    }
    const confirmed = await confirmPassword(db, token.transmitterId, body.password);
    if (confirmed.fail) return reply.status(confirmed.fail.status).send(confirmed.fail.body);
    const [taken] = await db.select({ id: transmitters.id }).from(transmitters).where(eq(transmitters.phone, phone)).limit(1);
    if (taken && taken.id !== token.transmitterId) return reply.status(409).send({ error: 'That number is already on another account', code: 'PHONE_TAKEN' });

    const ip = request.ip;
    const hit = await overLimit(redis, [
      ['PHONE_VERIFY_PER_USER', token.transmitterId],
      ['PHONE_VERIFY_PER_IP', ip],
      ['PHONE_CODES_PER_USER', token.transmitterId],
      ['PHONE_CODES_PER_NUMBER', phone],
      ['PHONE_CODES_PER_IP', ip],
    ]);
    if (hit) return refuse(reply, hit);
    // Mobile lines only: VoIP numbers are free to mint by the thousand.
    const line = await lineTypeCheck(app, phone);
    if (line.verdict === 'refused') return reply.status(400).send({ error: 'Use a mobile number. VoIP, landline and toll-free numbers cannot be verified.', code: 'PHONE_LINE_TYPE_REFUSED', lineType: line.type });
    if (line.verdict === 'unknown') return reply.status(503).send({ error: 'We could not check that number. Try again in a few minutes.', code: 'PHONE_LOOKUP_FAILED' });
    const vpn = await vpnCheck(app, ip);
    if (vpn === 'vpn') return reply.status(403).send({ error: 'Turn off your VPN or proxy to verify a phone number', code: 'PHONE_VPN_BLOCKED' });
    if (vpn === 'unknown') return reply.status(503).send({ error: 'We could not check your connection. Try again in a few minutes.', code: 'PHONE_VPN_UNCHECKED' });

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db
      .update(transmitters)
      .set({ phonePending: phone, phoneCodeHash: hash(code), phoneCodeExpiresAt: new Date(Date.now() + 10 * 60_000) })
      .where(eq(transmitters.id, token.transmitterId));
    await redis.del(`phone:attempts:${token.transmitterId}`);
    // Counted before sending: a failed send may still have cost a text.
    await count(redis, 'PHONE_CODES_PER_USER', token.transmitterId);
    await count(redis, 'PHONE_CODES_PER_NUMBER', phone);
    await count(redis, 'PHONE_CODES_PER_IP', ip);
    try {
      await sendSms(app, phone, `Subspace Frequency: your verification code is ${code}. It expires in 10 minutes. Reply STOP to opt out.`);
    } catch (err) {
      return reply.status(502).send({ error: (err as Error).message, code: 'SMS_FAILED' });
    }
    return reply.send({ sent: true, to: phone });
  });

  app.post('/users/@me/phone/verify', { schema: { body: { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string', pattern: '^[0-9]{6}$' } } } } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    const redis = (app as any).redis;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    if (redis?.status !== 'ready') return reply.status(503).send({ error: 'Phone verification is unavailable right now', code: 'SMS_UNAVAILABLE' });
    const [me] = await db.select().from(transmitters).where(eq(transmitters.id, token.transmitterId)).limit(1);
    const { code } = request.body as { code: string };
    const voidCode = () => db.update(transmitters).set({ phonePending: null, phoneCodeHash: null, phoneCodeExpiresAt: null }).where(eq(transmitters.id, token.transmitterId));
    if (!me?.phonePending || !me.phoneCodeHash || !me.phoneCodeExpiresAt || new Date(me.phoneCodeExpiresAt) < new Date()) {
      return reply.status(400).send({ error: 'That code is wrong or has expired', code: 'INVALID_CODE' });
    }
    if (!sameHash(me.phoneCodeHash, hash(code))) {
      // A handful of guesses per code, then it is void and a new one has to be sent.
      const tries = await redis.incr(`phone:attempts:${token.transmitterId}`);
      await redis.expire(`phone:attempts:${token.transmitterId}`, 900);
      if (tries >= codeAttempts()) {
        await voidCode();
        return reply.status(400).send({ error: 'Too many wrong codes. Send a new one.', code: 'CODE_ATTEMPTS_EXCEEDED' });
      }
      return reply.status(400).send({ error: 'That code is wrong or has expired', code: 'INVALID_CODE' });
    }
    const hit = await overLimit(redis, [
      ['PHONE_VERIFY_PER_USER', token.transmitterId],
      ['PHONE_VERIFY_PER_IP', request.ip],
    ]);
    if (hit) return refuse(reply, hit);
    // Someone else may have verified the number since this code was sent.
    const [taken] = await db.select({ id: transmitters.id }).from(transmitters).where(eq(transmitters.phone, me.phonePending)).limit(1);
    if (taken && taken.id !== token.transmitterId) {
      await voidCode();
      return reply.status(409).send({ error: 'That number is already on another account', code: 'PHONE_TAKEN' });
    }
    try {
      await db
        .update(transmitters)
        .set({ phone: me.phonePending, phoneVerifiedAt: new Date(), phonePending: null, phoneCodeHash: null, phoneCodeExpiresAt: null })
        .where(eq(transmitters.id, token.transmitterId));
    } catch {
      // Lost a race for the same number (one account per number is a unique index).
      await voidCode();
      return reply.status(409).send({ error: 'That number is already on another account', code: 'PHONE_TAKEN' });
    }
    await redis.del(`phone:attempts:${token.transmitterId}`);
    await count(redis, 'PHONE_VERIFY_PER_USER', token.transmitterId);
    await count(redis, 'PHONE_VERIFY_PER_IP', request.ip);
    return reply.send({ phone: me.phonePending });
  });

  app.delete('/users/@me/phone', { schema: { body: { type: 'object', additionalProperties: false, required: ['password'], properties: { password: { type: 'string' } } } } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const confirmed = await confirmPassword(db, token.transmitterId, (request.body as any).password);
    if (confirmed.fail) return reply.status(confirmed.fail.status).send(confirmed.fail.body);
    await db.update(transmitters).set({ phone: null, phoneVerifiedAt: null }).where(eq(transmitters.id, token.transmitterId));
    return reply.send({ phone: null });
  });
};
