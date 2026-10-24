import { randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, eq, transmitters, transmitterPasskeys } from '@subspace/database';
import { PasskeyManager } from '@subspace/crypto';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { confirmPassword } from '../../lib/confirm-password.js';
import { checkRateLimit } from '../../lib/rate-limit.js';
import { issueSession } from './auth.routes.js';
import { trustedOrigin } from '../../lib/origin.js';

const RP_NAME = process.env.RP_NAME || 'Subspace Frequency';
const CHALLENGE_TTL_SECONDS = 300;
const MAX_PASSKEYS = 10;

/**
 * The relying party for this request. Production accepts only the configured origins
 * (WEBAUTHN_ORIGINS, else PUBLIC_ORIGIN); development also accepts any localhost origin.
 */
export function relyingParty(request: FastifyRequest): { origin: string; rpID: string } | null {
  const url = trustedOrigin(request);
  return url ? { origin: url.origin, rpID: process.env.RP_ID || url.hostname } : null;
}

const publicPasskey = (p: any) => ({
  id: p.id,
  name: p.name,
  deviceType: p.deviceType,
  backedUp: p.backedUp,
  createdAt: p.createdAt,
});

export const passkeyRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = (app as any).redis;
  const badOrigin = { error: 'Passkeys are not available from this address', code: 'WEBAUTHN_ORIGIN' };

  /** GET /api/v1/auth/passkeys */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const rows = await db.select().from(transmitterPasskeys).where(eq(transmitterPasskeys.transmitterId, token.transmitterId));
    return reply.send({ passkeys: rows.map(publicPasskey) });
  });

  /**
   * POST /api/v1/auth/passkeys/register/options  { password }
   * Adding a sign-in method is a sensitive change, so it needs the current password.
   */
  app.post(
    '/register/options',
    { schema: { body: { type: 'object', properties: { password: { type: 'string', maxLength: 200 } } } } },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      if (!db || !redis) return reply.status(503).send({ error: 'Service unavailable' });
      const rp = relyingParty(request);
      if (!rp) return reply.status(400).send(badOrigin);
      const check = await confirmPassword(db, token.transmitterId, (request.body as any)?.password);
      if (check.fail) return reply.status(check.fail.status).send(check.fail.body);
      const user = check.user;
      const existing = await db.select().from(transmitterPasskeys).where(eq(transmitterPasskeys.transmitterId, user.id));
      if (existing.length >= MAX_PASSKEYS) return reply.status(400).send({ error: `You can have up to ${MAX_PASSKEYS} passkeys`, code: 'TOO_MANY_PASSKEYS' });

      const options = await PasskeyManager.generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: rp.rpID,
        userName: `${user.username}#${user.discriminator}`,
        userDisplayName: user.displayName || user.username,
        userID: new TextEncoder().encode(user.id),
        attestationType: 'none',
        excludeCredentials: existing.map((p: any) => ({ id: p.credentialId, transports: p.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      });
      await redis.set(`webauthn:reg:${user.id}`, JSON.stringify({ challenge: options.challenge, ...rp }), 'EX', CHALLENGE_TTL_SECONDS);
      return reply.send({ options });
    }
  );

  /** POST /api/v1/auth/passkeys/register/verify  { response, name } */
  app.post(
    '/register/verify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['response'],
          properties: { response: { type: 'object' }, name: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      if (!db || !redis) return reply.status(503).send({ error: 'Service unavailable' });
      const key = `webauthn:reg:${token.transmitterId}`;
      const pending = await redis.get(key);
      await redis.del(key);
      if (!pending) return reply.status(400).send({ error: 'Passkey setup expired. Start again.', code: 'CHALLENGE_EXPIRED' });
      const { challenge, origin, rpID } = JSON.parse(pending);
      const body = request.body as { response: any; name?: string };

      let verification;
      try {
        verification = await PasskeyManager.verifyRegistrationResponse({
          response: body.response,
          expectedChallenge: challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
        });
      } catch (err) {
        return reply.status(400).send({ error: 'The passkey could not be verified', code: 'PASSKEY_INVALID', details: (err as Error).message });
      }
      if (!verification.verified || !verification.registrationInfo) return reply.status(400).send({ error: 'The passkey could not be verified', code: 'PASSKEY_INVALID' });

      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
      const [taken] = await db.select({ id: transmitterPasskeys.id }).from(transmitterPasskeys).where(eq(transmitterPasskeys.credentialId, credential.id)).limit(1);
      if (taken) return reply.status(409).send({ error: 'That passkey is already registered', code: 'PASSKEY_EXISTS' });
      const [saved] = await db
        .insert(transmitterPasskeys)
        .values({
          transmitterId: token.transmitterId,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString('base64url'),
          counter: credential.counter,
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          transports: credential.transports ?? [],
          name: body.name?.trim() || 'Passkey',
        })
        .returning();
      return reply.status(201).send({ passkey: publicPasskey(saved) });
    }
  );

  /** PATCH /api/v1/auth/passkeys/:id  { name } */
  app.patch(
    '/:id',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 64 } } },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      const { id } = request.params as { id: string };
      const [updated] = await db
        .update(transmitterPasskeys)
        .set({ name: (request.body as { name: string }).name.trim() })
        .where(and(eq(transmitterPasskeys.id, id), eq(transmitterPasskeys.transmitterId, token.transmitterId)))
        .returning();
      if (!updated) return reply.status(404).send({ error: 'Passkey not found' });
      return reply.send({ passkey: publicPasskey(updated) });
    }
  );

  /** POST /api/v1/auth/passkeys/:id/delete  { password } */
  app.post(
    '/:id/delete',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', properties: { password: { type: 'string', maxLength: 200 } } },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      const check = await confirmPassword(db, token.transmitterId, (request.body as any)?.password);
      if (check.fail) return reply.status(check.fail.status).send(check.fail.body);
      const { id } = request.params as { id: string };
      const deleted = await db
        .delete(transmitterPasskeys)
        .where(and(eq(transmitterPasskeys.id, id), eq(transmitterPasskeys.transmitterId, token.transmitterId)))
        .returning();
      if (!deleted.length) return reply.status(404).send({ error: 'Passkey not found' });
      return reply.status(204).send();
    }
  );

  /**
   * POST /api/v1/auth/passkeys/login/options
   * Passwordless sign-in. The browser offers any passkey it has for this site.
   */
  app.post('/login/options', { config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!redis) return reply.status(503).send({ error: 'Service unavailable' });
    const rp = relyingParty(request);
    if (!rp) return reply.status(400).send(badOrigin);
    const options = await PasskeyManager.generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'required' });
    const challengeId = randomUUID();
    await redis.set(`webauthn:auth:${challengeId}`, JSON.stringify({ challenge: options.challenge, ...rp }), 'EX', CHALLENGE_TTL_SECONDS);
    return reply.send({ options, challengeId });
  });

  /**
   * POST /api/v1/auth/passkeys/login/verify  { challengeId, response, reactivate? }
   * A user-verified passkey is both factors, so it signs in without the TOTP step.
   */
  app.post(
    '/login/verify',
    {
      config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['challengeId', 'response'],
          properties: { challengeId: { type: 'string', format: 'uuid' }, response: { type: 'object' }, reactivate: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      if (!db || !redis) return reply.status(503).send({ error: 'Service unavailable' });
      const body = request.body as { challengeId: string; response: any; reactivate?: boolean };
      const ip = request.ip;
      if (!(await checkRateLimit(redis, `rl:passkey:ip:${ip}`, 20, 60))) return reply.status(429).send({ error: 'Too many attempts; try again shortly' });
      const key = `webauthn:auth:${body.challengeId}`;
      const pending = await redis.get(key);
      await redis.del(key);
      if (!pending) return reply.status(400).send({ error: 'Sign-in expired. Try again.', code: 'CHALLENGE_EXPIRED' });
      const { challenge, origin, rpID } = JSON.parse(pending);

      const credentialId = typeof body.response?.id === 'string' ? body.response.id : '';
      const [passkey] = credentialId
        ? await db.select().from(transmitterPasskeys).where(eq(transmitterPasskeys.credentialId, credentialId)).limit(1)
        : [];
      const invalid = { error: 'That passkey is not registered to an account', code: 'PASSKEY_UNKNOWN' };
      if (!passkey) return reply.status(401).send(invalid);

      let verification;
      try {
        verification = await PasskeyManager.verifyAuthenticationResponse({
          response: body.response,
          expectedChallenge: challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: { id: passkey.credentialId, publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')), counter: passkey.counter, transports: passkey.transports },
          requireUserVerification: true,
        });
      } catch {
        return reply.status(401).send(invalid);
      }
      if (!verification.verified) return reply.status(401).send(invalid);
      await db.update(transmitterPasskeys).set({ counter: verification.authenticationInfo.newCounter }).where(eq(transmitterPasskeys.id, passkey.id));

      const [user] = await db.select().from(transmitters).where(eq(transmitters.id, passkey.transmitterId)).limit(1);
      if (!user || user.deletedAt) return reply.status(401).send(invalid);
      if (user.isBanned) {
        return reply.status(403).send({ error: 'Transmitter account has been suspended by Command Staff', code: 'TRANSMITTER_SUSPENDED', reason: user.banReason || 'Violation of Subspace Directives' });
      }
      if (user.disabledAt) {
        if (body.reactivate !== true) return reply.status(403).send({ error: 'This account is disabled', code: 'ACCOUNT_DISABLED' });
        await db.update(transmitters).set({ disabledAt: null, updatedAt: new Date() }).where(eq(transmitters.id, user.id));
      }
      return reply.send({ message: 'Transmitter authenticated', ...(await issueSession(redis, user, request)) });
    }
  );
};
