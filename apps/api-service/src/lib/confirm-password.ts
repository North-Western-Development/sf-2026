import { eq, transmitters } from '@subspace/database';
import { verifyPassword } from '@subspace/crypto';

/**
 * Re-check the caller's password for a sensitive account change. Wrong passwords are 400,
 * not 401: a 401 means "session expired" and the client would sign the user out.
 */
type Confirmed = { user: any; fail?: undefined } | { user?: undefined; fail: { status: number; body: Record<string, unknown> } };

export async function confirmPassword(db: any, transmitterId: string, password: unknown): Promise<Confirmed> {
  const [user] = await db.select().from(transmitters).where(eq(transmitters.id, transmitterId)).limit(1);
  if (!user) return { fail: { status: 404, body: { error: 'Transmitter not found' } } };
  if (typeof password !== 'string' || !password) {
    return { fail: { status: 400, body: { error: 'Password required', code: 'PASSWORD_REQUIRED' } } };
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    return { fail: { status: 400, body: { error: 'Current password is incorrect', code: 'PASSWORD_INCORRECT' } } };
  }
  return { user };
}
