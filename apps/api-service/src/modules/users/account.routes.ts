import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createHash, randomInt } from 'node:crypto';
import { and, eq, gte, incidentReports, transmissions, transmitters, vaultFiles } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { confirmPassword } from '../../lib/confirm-password.js';
import { sendSms, smsAvailable } from '../../lib/sms.js';

const hash = (code: string) => createHash('sha256').update(code).digest('hex');
const E164 = /^\+[1-9]\d{7,14}$/;
const YEAR = 365 * 86_400_000;

/**
 * Account extras (User Settings › My Account):
 *   GET    /users/@me/standing            Account Standing: violations staff acted on, and limits
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

  app.post('/users/@me/phone', { schema: { body: { type: 'object', additionalProperties: false, required: ['phone', 'password'], properties: { phone: { type: 'string', maxLength: 20 }, password: { type: 'string' } } } } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    if (!smsAvailable()) return reply.status(503).send({ error: 'Text messages are not set up on this server', code: 'SMS_UNAVAILABLE' });
    const body = request.body as { phone: string; password: string };
    const phone = body.phone.replace(/[\s()-]/g, '');
    if (!E164.test(phone)) return reply.status(400).send({ error: 'Enter the number with its country code, like +1 555 010 0199', code: 'INVALID_PHONE' });
    const confirmed = await confirmPassword(db, token.transmitterId, body.password);
    if (confirmed.fail) return reply.status(confirmed.fail.status).send(confirmed.fail.body);
    const [taken] = await db.select({ id: transmitters.id }).from(transmitters).where(eq(transmitters.phone, phone)).limit(1);
    if (taken && taken.id !== token.transmitterId) return reply.status(409).send({ error: 'That number is already on another account', code: 'PHONE_TAKEN' });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db
      .update(transmitters)
      .set({ phonePending: phone, phoneCodeHash: hash(code), phoneCodeExpiresAt: new Date(Date.now() + 10 * 60_000) })
      .where(eq(transmitters.id, token.transmitterId));
    try {
      await sendSms(app, phone, `Your Subspace verification code is ${code}. It expires in 10 minutes.`);
    } catch (err) {
      return reply.status(502).send({ error: (err as Error).message, code: 'SMS_FAILED' });
    }
    return reply.send({ sent: true, to: phone });
  });

  app.post('/users/@me/phone/verify', { schema: { body: { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string', pattern: '^[0-9]{6}$' } } } } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const [me] = await db.select().from(transmitters).where(eq(transmitters.id, token.transmitterId)).limit(1);
    const { code } = request.body as { code: string };
    if (!me?.phonePending || !me.phoneCodeHash || !me.phoneCodeExpiresAt || new Date(me.phoneCodeExpiresAt) < new Date() || me.phoneCodeHash !== hash(code)) {
      return reply.status(400).send({ error: 'That code is wrong or has expired', code: 'INVALID_CODE' });
    }
    await db
      .update(transmitters)
      .set({ phone: me.phonePending, phoneVerifiedAt: new Date(), phonePending: null, phoneCodeHash: null, phoneCodeExpiresAt: null })
      .where(eq(transmitters.id, token.transmitterId));
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
