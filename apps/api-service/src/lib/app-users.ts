import crypto from 'node:crypto';
import { eq, transmitters, newSnowflake } from '@subspace/database';
import { getJwtSecret } from '@subspace/crypto';

/**
 * Accounts that are not people: a Developer Application's bot, or a webhook's author. They have
 * no usable password (sign-in refuses them by botKind) and no email anyone can reach.
 */
export async function createAppUser(db: any, kind: 'bot' | 'webhook', name: string, avatarUrl: string | null = null): Promise<string> {
  const id = newSnowflake();
  const slug = name.toLowerCase().replace(/[^a-z0-9_.]+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, 24) || kind;
  await db.insert(transmitters).values({
    id,
    // The id's last digits: its first ones are the time, and repeat for minutes on end.
    username: `${slug}_${id.slice(-6)}`,
    discriminator: '0000',
    email: `${id}@${kind}s.subspace.invalid`,
    passwordHash: '!',
    displayName: name,
    avatarUrl,
    isEmailVerified: true,
    botKind: kind,
  });
  return id;
}

export async function renameAppUser(db: any, id: string, name: string, avatarUrl?: string | null) {
  await db
    .update(transmitters)
    .set({ displayName: name, ...(avatarUrl !== undefined ? { avatarUrl } : {}), updatedAt: new Date() })
    .where(eq(transmitters.id, id));
}

/** A secret shown once; only its SHA-256 is kept. */
export const newSecret = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const hashSecret = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// ---- Encrypting a bot's signing key at rest -------------------------------------------

const boxKey = () => crypto.createHash('sha256').update(`app-keys:${process.env.DRIVE_TOKEN_KEY || getJwtSecret()}`).digest();

export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', boxKey(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function openSecret(sealed: string): string {
  const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', boxKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}
