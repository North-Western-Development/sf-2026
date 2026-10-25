import { eq, transmitters } from '@subspace/database';

/** True when staff have quarantined the account: it can read but not reach out to new people or beacons. */
export async function isQuarantined(db: any, transmitterId: string): Promise<boolean> {
  const [row] = await db.select({ q: transmitters.quarantinedAt }).from(transmitters).where(eq(transmitters.id, transmitterId)).limit(1);
  return !!row?.q;
}

export const QUARANTINED = { error: 'This account is quarantined by Subspace staff and cannot do that', code: 'QUARANTINED' } as const;
