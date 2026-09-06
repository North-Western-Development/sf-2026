import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, transmitters, transmitterPasskeys } from '@subspace/database';
import {
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  verifyTotpToken,
  generateBackupCodes,
  verifyBackupCode,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  TokenPayload,
  PasskeyManager,
} from '@subspace/crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
const RP_NAME = process.env.RP_NAME || 'Subspace Frequency';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:3000';
const CURRENT_RULES_VERSION = 1;

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = (app as any).redis;

  /**
   * POST /api/v1/auth/register
   */
  app.post('/register', async (request, reply) => {
    const body = request.body as any;
    const { username, email, password, displayName } = body || {};

    if (!username || !email || !password) {
      return reply.status(400).send({ error: 'Missing required credentials' });
    }

    if (password.length < 8) {
      return reply.status(400).send({ error: 'Password must be at least 8 characters long' });
    }

    if (!db) {
      return reply.status(503).send({ error: 'Database service unavailable' });
    }

    const existingUser = await db
      .select()
      .from(transmitters)
      .where(eq(transmitters.username, username.trim()))
      .limit(1);

    if (existingUser.length > 0) {
      return reply.status(409).send({ error: 'Transmitter username already exists' });
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
        username: username.trim(),
        email: email.trim().toLowerCase(),
        passwordHash,
        displayName: displayName?.trim() || username.trim(),
        isEmailVerified: true, // Default to true if SMTP toggle is off
        lastAgreedRulesVersion: CURRENT_RULES_VERSION,
      })
      .returning();

    const accessToken = signAccessToken(
      {
        transmitterId: newTransmitter.id,
        username: newTransmitter.username,
        staffRank: newTransmitter.staffRank,
      },
      JWT_SECRET
    );

    const refreshToken = signRefreshToken(newTransmitter.id, JWT_SECRET);

    return reply.status(201).send({
      message: 'Transmitter registered successfully',
      transmitter: {
        id: newTransmitter.id,
        username: newTransmitter.username,
        email: newTransmitter.email,
        displayName: newTransmitter.displayName,
        displayColor: newTransmitter.displayColor,
        displayFont: newTransmitter.displayFont,
        staffRank: newTransmitter.staffRank,
      },
      accessToken,
      refreshToken,
    });
  });

  /**
   * POST /api/v1/auth/login
   */
  app.post('/login', async (request, reply) => {
    const body = request.body as any;
    const { username, password } = body || {};

    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    if (!db) {
      return reply.status(503).send({ error: 'Database service unavailable' });
    }

    const [user] = await db
      .select()
      .from(transmitters)
      .where(eq(transmitters.username, username.trim()))
      .limit(1);

    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Check if 2FA is active
    if (user.is2faEnabled) {
      const tempToken = signAccessToken(
        {
          transmitterId: user.id,
          username: user.username,
          staffRank: user.staffRank,
        },
        JWT_SECRET,
        '5m'
      );
      return reply.send({
        requires2FA: true,
        tempToken,
      });
    }

    // Check Directives Rules agreement
    const requiresRulesAgreement = user.lastAgreedRulesVersion < CURRENT_RULES_VERSION;

    const accessToken = signAccessToken(
      {
        transmitterId: user.id,
        username: user.username,
        staffRank: user.staffRank,
      },
      JWT_SECRET
    );
    const refreshToken = signRefreshToken(user.id, JWT_SECRET);

    return reply.send({
      message: 'Transmitter authenticated',
      requiresRulesAgreement,
      transmitter: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        displayColor: user.displayColor,
        displayFont: user.displayFont,
        staffRank: user.staffRank,
      },
      accessToken,
      refreshToken,
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
    const payload = verifyToken<TokenPayload>(token, JWT_SECRET);
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
  app.post('/2fa/verify', async (request, reply) => {
    const body = request.body as any;
    const { token, code, isBackupCode } = body || {};

    if (!token || !code) {
      return reply.status(400).send({ error: 'Token and 2FA code required' });
    }

    const payload = verifyToken<TokenPayload>(token, JWT_SECRET);
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

    const accessToken = signAccessToken(
      {
        transmitterId: user.id,
        username: user.username,
        staffRank: user.staffRank,
      },
      JWT_SECRET
    );
    const refreshToken = signRefreshToken(user.id, JWT_SECRET);

    return reply.send({
      message: '2FA verification verified',
      accessToken,
      refreshToken,
    });
  });

  /**
   * POST /api/v1/auth/directives/accept
   */
  app.post('/directives/accept', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyToken<TokenPayload>(token, JWT_SECRET);
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
};
