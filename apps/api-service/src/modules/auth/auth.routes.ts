import { randomBytes } from 'node:crypto';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, transmitters, transmitterPasskeys } from '@subspace/database';
import { SUBSPACE_DIRECTIVES, isValidUsername } from '@subspace/constants';
import { checkRateLimit } from '../../lib/rate-limit.js';
import {
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  verifyTotpToken,
  generateBackupCodes,
  verifyBackupCode,
  signAccessToken,
  signRefreshToken,
  signTwoFactorChallengeToken,
  verifyAccessToken,
  verifyTypedToken,
  TokenPayload,
  PasskeyManager,
  getJwtSecret,
} from '@subspace/crypto';

const JWT_SECRET = getJwtSecret();
const RP_NAME = process.env.RP_NAME || 'Subspace Frequency';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:3000';
const CURRENT_RULES_VERSION = SUBSPACE_DIRECTIVES.version;

const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

function extractPayload(request: any): TokenPayload | null {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  return verifyAccessToken(authHeader.split(' ')[1], JWT_SECRET);
}

export { serializeTransmitter } from '../../lib/serialize.js';
import { serializeTransmitter } from '../../lib/serialize.js';

/**
 * Issue an access + refresh pair. Refresh tokens are single-use: their jti is stored in
 * Redis and consumed on /refresh, and removed on /logout.
 */
async function issueSession(redis: any, user: any) {
  const jti = randomBytes(16).toString('hex');
  const accessToken = signAccessToken(
    { transmitterId: user.id, username: user.username, staffRank: user.staffRank },
    JWT_SECRET
  );
  const refreshToken = signRefreshToken(user.id, JWT_SECRET, '30d', jti, user.tokenVersion || 0);
  if (redis) {
    await redis.set(`refresh:${jti}`, user.id, 'EX', REFRESH_TTL_SECONDS).catch(() => {});
  }
  return {
    accessToken,
    refreshToken,
    transmitter: serializeTransmitter(user),
    requiresRulesAgreement: (user.lastAgreedRulesVersion ?? 0) < CURRENT_RULES_VERSION,
  };
}

/**
 * Generate a random non-sequential 4-digit discriminator (0001 - 9999)
 */
function generateRandomDiscriminator(): string {
  const num = Math.floor(Math.random() * 9999) + 1;
  return num.toString().padStart(4, '0');
}

/**
 * Find an available 4-digit discriminator for a given username
 */
async function allocateDiscriminator(db: any, username: string): Promise<string | null> {
  const takenUsers = await db
    .select({ discriminator: transmitters.discriminator })
    .from(transmitters)
    .where(eq(transmitters.username, username));

  const takenSet = new Set(takenUsers.map((u: any) => u.discriminator));
  if (takenSet.size >= 9999) {
    return null; // All 9999 discriminators taken
  }

  // Try random picks first (typically succeeds on first try)
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = generateRandomDiscriminator();
    if (!takenSet.has(candidate)) {
      return candidate;
    }
  }

  // If high collision, find first untaken randomly from remaining
  const untaken: string[] = [];
  for (let i = 1; i <= 9999; i++) {
    const candidate = i.toString().padStart(4, '0');
    if (!takenSet.has(candidate)) {
      untaken.push(candidate);
    }
  }
  return untaken.length > 0 ? untaken[Math.floor(Math.random() * untaken.length)] : null;
}

// The isolated UI-test stack raises this (every browser test registers fresh accounts). Never honoured in production.
const REGISTER_LIMIT = process.env.NODE_ENV !== 'production' && Number(process.env.REGISTER_RATE_LIMIT) > 0 ? Number(process.env.REGISTER_RATE_LIMIT) : 5;

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = (app as any).redis;

  /**
   * POST /api/v1/auth/register
   */
  app.post('/register', { config: { rateLimit: { max: REGISTER_LIMIT, timeWindow: '1 hour' } } }, async (request, reply) => {
    const body = request.body as any;
    const { username, email, password, displayName, acceptDirectives } = body || {};

    if (!username || !email || !password) {
      return reply.status(400).send({ error: 'Missing required credentials' });
    }

    if (password.length < 8) {
      return reply.status(400).send({ error: 'Password must be at least 8 characters long' });
    }

    if (!db) {
      return reply.status(503).send({ error: 'Database service unavailable' });
    }

    const cleanUsername = username.trim().toLowerCase();
    if (!isValidUsername(cleanUsername)) {
      return reply.status(400).send({
        error: 'Username must be 2-32 characters of lowercase letters, digits, underscore, or period, and cannot start/end with or repeat a period',
        code: 'INVALID_USERNAME',
      });
    }

    // Allocate random non-sequential 4-digit discriminator
    const discriminator = await allocateDiscriminator(db, cleanUsername);
    if (!discriminator) {
      return reply.status(409).send({
        error: 'All discriminator tags for this username are currently in use',
        code: 'DISCRIMINATOR_POOL_EXHAUSTED',
      });
    }

    const existingEmail = await db
      .select()
      .from(transmitters)
      .where(eq(transmitters.email, email.trim().toLowerCase()))
      .limit(1);

    if (existingEmail.length > 0) {
      return reply.status(409).send({ error: 'Email address already in use' });
    }

    const passwordHash = await hashPassword(password);
    const [newTransmitter] = await db
      .insert(transmitters)
      .values({
        username: cleanUsername,
        discriminator,
        email: email.trim().toLowerCase(),
        passwordHash,
        displayName: displayName?.trim() || username.trim(),
        isEmailVerified: true, // Default to true if SMTP toggle is off
        lastAgreedRulesVersion: acceptDirectives === true ? CURRENT_RULES_VERSION : 0,
      })
      .returning();

    return reply.status(201).send({
      message: 'Transmitter registered successfully',
      ...(await issueSession(redis, newTransmitter)),
    });
  });

  /**
   * POST /api/v1/auth/login
   */
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = request.body as any;
    const { username, password } = body || {};

    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    if (!db) {
      return reply.status(503).send({ error: 'Database service unavailable' });
    }

    const cleanInput = username.trim();

    const accountKey = `rl:login:account:${cleanInput.toLowerCase()}`;
    if (!(await checkRateLimit(redis, accountKey, 5, 60))) {
      return reply.status(429).send({ error: 'Too many login attempts for this account; try again shortly' });
    }
    let user: any = null;

    if (cleanInput.includes('#')) {
      const [uName, disc] = cleanInput.split('#');
      const users = await db
        .select()
        .from(transmitters)
        .where(
          and(
            eq(transmitters.username, uName.toLowerCase()),
            eq(transmitters.discriminator, disc)
          )
        )
        .limit(1);
      user = users[0];
    } else if (cleanInput.includes('@')) {
      const users = await db
        .select()
        .from(transmitters)
        .where(eq(transmitters.email, cleanInput.toLowerCase()))
        .limit(1);
      user = users[0];
    } else {
      // Usernames are only unique together with their discriminator; a bare
      // username is accepted only when it identifies exactly one transmitter.
      const users = await db
        .select()
        .from(transmitters)
        .where(eq(transmitters.username, cleanInput.toLowerCase()))
        .limit(2);
      if (users.length > 1) {
        return reply.status(400).send({
          error: 'Multiple transmitters share this username; sign in with username#0000 or email',
          code: 'AMBIGUOUS_USERNAME',
        });
      }
      user = users[0];
    }

    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Invariant: Suspended/banned accounts cannot log in
    if (user.isBanned) {
      return reply.status(403).send({
        error: 'Transmitter account has been suspended by Command Staff',
        code: 'TRANSMITTER_SUSPENDED',
        reason: user.banReason || 'Violation of Subspace Directives',
      });
    }

    // Check if 2FA is active
    if (user.is2faEnabled) {
      return reply.send({
        requires2FA: true,
        tempToken: signTwoFactorChallengeToken(user.id, JWT_SECRET),
      });
    }

    return reply.send({
      message: 'Transmitter authenticated',
      ...(await issueSession(redis, user)),
    });
  });

  /**
   * POST /api/v1/auth/2fa/setup
   */
  app.post('/2fa/setup', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyAccessToken(token, JWT_SECRET);
    if (!payload) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }

    const { secret, uri } = generateTotpSecret('Subspace Frequency', payload.username);
    const { plainCodes, hashedCodes } = generateBackupCodes(10);

    // Temporarily save in Redis or DB until verified
    if (redis) {
      await redis.setex(
        `2fa_pending:${payload.transmitterId}`,
        600,
        JSON.stringify({ secret, hashedCodes })
      );
    }

    return reply.send({
      secret,
      uri,
      backupCodes: plainCodes,
    });
  });

  /**
   * POST /api/v1/auth/2fa/verify
   */
  app.post(
    '/2fa/verify',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '5 minutes',
          keyGenerator: (request: any) => (request.body && request.body.token) || request.ip,
        },
      },
    },
    async (request, reply) => {
    const body = request.body as any;
    const { token, code, isBackupCode } = body || {};

    if (!token || !code) {
      return reply.status(400).send({ error: 'Token and 2FA code required' });
    }

    // Either a login challenge (password already verified) or an access token
    // confirming a pending 2FA setup. Nothing else is accepted.
    const challenge = verifyTypedToken<{ transmitterId: string }>(token, JWT_SECRET, '2fa_challenge');
    const payload = challenge ?? verifyAccessToken(token, JWT_SECRET);
    if (!payload) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }

    if (!db) {
      return reply.status(503).send({ error: 'Database service unavailable' });
    }

    const [user] = await db
      .select()
      .from(transmitters)
      .where(eq(transmitters.id, payload.transmitterId))
      .limit(1);

    if (!user) {
      return reply.status(404).send({ error: 'Transmitter not found' });
    }

    if (!user.is2faEnabled && challenge) {
      return reply.status(400).send({ error: '2FA is not enabled for this transmitter' });
    }

    // If setting up for the first time
    if (!user.is2faEnabled && redis) {
      const pendingData = await redis.get(`2fa_pending:${user.id}`);
      if (!pendingData) {
        return reply.status(400).send({ error: 'No 2FA setup in progress or setup expired' });
      }
      const { secret, hashedCodes } = JSON.parse(pendingData);
      const isTotpValid = verifyTotpToken(secret, code);
      if (!isTotpValid) {
        return reply.status(400).send({ error: 'Invalid 2FA verification code' });
      }

      await db
        .update(transmitters)
        .set({
          is2faEnabled: true,
          totpSecret: secret,
          backupCodes: hashedCodes,
        })
        .where(eq(transmitters.id, user.id));

      await redis.del(`2fa_pending:${user.id}`);

      return reply.send({ message: '2FA security protocol activated successfully' });
    }

    // Completing a login requires the challenge ticket issued by /login.
    if (!challenge) {
      return reply.status(400).send({ error: '2FA is already enabled' });
    }

    // Logging in with active 2FA
    if (isBackupCode) {
      const { valid, remaining } = verifyBackupCode(code, user.backupCodes || []);
      if (!valid) {
        return reply.status(400).send({ error: 'Invalid backup code' });
      }
      await db
        .update(transmitters)
        .set({ backupCodes: remaining })
        .where(eq(transmitters.id, user.id));
    } else {
      if (!user.totpSecret) {
        return reply.status(400).send({ error: '2FA secret not found' });
      }
      const isValid = verifyTotpToken(user.totpSecret, code);
      if (!isValid) {
        return reply.status(400).send({ error: 'Invalid 2FA code' });
      }
    }

    return reply.send({
      message: '2FA verification verified',
      ...(await issueSession(redis, user)),
    });
  });

  /**
   * POST /api/v1/auth/refresh
   * Exchange a refresh token for a new session (rotating the refresh token).
   */
  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = (request.body as any) || {};
    const payload =
      typeof refreshToken === 'string'
        ? verifyTypedToken<{ transmitterId: string; tokenVersion?: number }>(refreshToken, JWT_SECRET, 'refresh')
        : null;
    if (!payload || !payload.jti) {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    if (redis) {
      const owner = await redis.getdel(`refresh:${payload.jti}`).catch(() => null);
      if (owner !== payload.transmitterId) {
        return reply.status(401).send({ error: 'Refresh token revoked or already used' });
      }
    }

    const [user] = await db.select().from(transmitters).where(eq(transmitters.id, payload.transmitterId)).limit(1);
    if (!user) return reply.status(401).send({ error: 'Transmitter not found' });
    if (user.isBanned) {
      return reply.status(403).send({ error: 'Transmitter account has been suspended', code: 'TRANSMITTER_SUSPENDED' });
    }
    // A password change bumps tokenVersion, invalidating every refresh token issued before it
    // (except the one re-issued to the changing session at that moment).
    if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      return reply.status(401).send({ error: 'Refresh token revoked or already used' });
    }

    return reply.send(await issueSession(redis, user));
  });

  /**
   * POST /api/v1/auth/logout
   * Revoke the supplied refresh token.
   */
  app.post('/logout', async (request, reply) => {
    const { refreshToken } = (request.body as any) || {};
    const payload =
      typeof refreshToken === 'string'
        ? verifyTypedToken<{ transmitterId: string }>(refreshToken, JWT_SECRET, 'refresh')
        : null;
    if (payload?.jti && redis) await redis.del(`refresh:${payload.jti}`).catch(() => {});
    return reply.status(204).send();
  });

  /**
   * GET /api/v1/auth/directives
   * Public: the instance rules shown at registration and whenever they change.
   */
  app.get('/directives', async () => SUBSPACE_DIRECTIVES);

  /**
   * POST /api/v1/auth/directives/accept
   */
  app.post('/directives/accept', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyAccessToken(token, JWT_SECRET);
    if (!payload) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }

    if (!db) {
      return reply.status(503).send({ error: 'Database service unavailable' });
    }

    await db
      .update(transmitters)
      .set({ lastAgreedRulesVersion: CURRENT_RULES_VERSION })
      .where(eq(transmitters.id, payload.transmitterId));

    return reply.send({
      message: 'Subspace Directives accepted',
      version: CURRENT_RULES_VERSION,
    });
  });

  /**
   * GET /api/v1/auth/me
   */
  app.get('/me', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyAccessToken(token, JWT_SECRET);
    if (!payload) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }

    if (!db) {
      return reply.status(503).send({ error: 'Database service unavailable' });
    }

    const [user] = await db
      .select()
      .from(transmitters)
      .where(eq(transmitters.id, payload.transmitterId))
      .limit(1);

    if (!user) {
      return reply.status(404).send({ error: 'Transmitter not found' });
    }

    return reply.send({
      transmitter: serializeTransmitter(user),
      requiresRulesAgreement: (user.lastAgreedRulesVersion ?? 0) < CURRENT_RULES_VERSION,
    });
  });

  /**
   * PATCH /api/v1/auth/me/password
   * Change password. Revokes every refresh token issued before this request except the
   * one re-issued in this response (bumping `tokenVersion` invalidates old refresh JWTs).
   */
  app.patch(
    '/me/password',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string' },
            newPassword: { type: 'string', minLength: 8 },
          },
        },
      },
    },
    async (request, reply) => {
      const payload = extractPayload(request);
      if (!payload) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };

      const [user] = await db.select().from(transmitters).where(eq(transmitters.id, payload.transmitterId)).limit(1);
      if (!user) return reply.status(404).send({ error: 'Transmitter not found' });

      const isValid = await verifyPassword(user.passwordHash, currentPassword);
      if (!isValid) return reply.status(401).send({ error: 'Current password is incorrect' });

      const newHash = await hashPassword(newPassword);
      const newTokenVersion = (user.tokenVersion || 0) + 1;

      const [updated] = await db
        .update(transmitters)
        .set({ passwordHash: newHash, tokenVersion: newTokenVersion, updatedAt: new Date() })
        .where(eq(transmitters.id, user.id))
        .returning();

      return reply.send({
        message: 'Password changed; other sessions have been signed out',
        ...(await issueSession(redis, updated)),
      });
    }
  );

  /**
   * POST /api/v1/auth/2fa/disable
   */
  app.post('/2fa/disable', async (request, reply) => {
    const payload = extractPayload(request);
    if (!payload) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { code } = (request.body as any) || {};
    if (!code) return reply.status(400).send({ error: '2FA code required' });

    const [user] = await db.select().from(transmitters).where(eq(transmitters.id, payload.transmitterId)).limit(1);
    if (!user) return reply.status(404).send({ error: 'Transmitter not found' });
    if (!user.is2faEnabled) return reply.status(400).send({ error: '2FA is not enabled for this transmitter' });

    let isValid = false;
    let remainingBackupCodes = user.backupCodes || [];
    if (user.totpSecret && verifyTotpToken(user.totpSecret, code)) {
      isValid = true;
    } else {
      const backupResult = verifyBackupCode(code, user.backupCodes || []);
      if (backupResult.valid) {
        isValid = true;
        remainingBackupCodes = backupResult.remaining;
      }
    }

    if (!isValid) return reply.status(400).send({ error: 'Invalid 2FA code' });

    await db
      .update(transmitters)
      .set({ is2faEnabled: false, totpSecret: null, backupCodes: remainingBackupCodes })
      .where(eq(transmitters.id, user.id));

    return reply.send({ message: '2FA security protocol deactivated' });
  });

  /**
   * PATCH /api/v1/auth/me/profile
   * Legacy alias for `PATCH /users/@me/profile` (section 9); same validated handler.
   */
  app.patch('/me/profile', async (request, reply) => {
    const payload = extractPayload(request);
    if (!payload) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { applyProfileUpdate } = await import('../profiles/profiles.routes.js');
    const result = await applyProfileUpdate(app, db, payload.transmitterId, request.body || {});
    return reply.status(result.status).send(result.body);
  });
};
