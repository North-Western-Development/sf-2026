import { eq, and, inArray, beacons, beaconMembers, clearances, transmitters } from '@subspace/database';

/**
 * Member rows in the shape returned by GET /beacons/:id/members, used for both the list
 * endpoint and MEMBER_ADD / MEMBER_UPDATE events so clients always receive full profiles.
 */
export async function buildMembers(db: any, redis: any, beaconId: string, onlyIds?: string[]): Promise<any[]> {
  const [beacon] = await db.select().from(beacons).where(eq(beacons.id, beaconId)).limit(1);
  if (!beacon) return [];

  const where = onlyIds?.length
    ? and(eq(beaconMembers.beaconId, beaconId), inArray(beaconMembers.transmitterId, onlyIds))
    : eq(beaconMembers.beaconId, beaconId);

  const rows = await db
    .select({
      transmitterId: beaconMembers.transmitterId,
      nickname: beaconMembers.nickname,
      hasCompletedOnboarding: beaconMembers.hasCompletedOnboarding,
      clearanceIds: beaconMembers.clearanceIds,
      joinedAt: beaconMembers.joinedAt,
      timeoutUntil: beaconMembers.timeoutUntil,
      memberAvatarUrl: beaconMembers.avatarUrl,
      memberBannerUrl: beaconMembers.bannerUrl,
      memberBio: beaconMembers.bio,
      memberPronouns: beaconMembers.pronouns,
      username: transmitters.username,
      discriminator: transmitters.discriminator,
      bio: transmitters.bio,
      bannerUrl: transmitters.bannerUrl,
      bannerColor: transmitters.bannerColor,
      displayName: transmitters.displayName,
      displayColor: transmitters.displayColor,
      displayFont: transmitters.displayFont,
      displayNameStyle: transmitters.displayNameStyle,
      avatarUrl: transmitters.avatarUrl,
      customStatus: transmitters.customStatus,
      staffRank: transmitters.staffRank,
      tagBeaconId: transmitters.tagBeaconId,
      avatarDecoration: transmitters.avatarDecoration,
    })
    .from(beaconMembers)
    .innerJoin(transmitters, eq(beaconMembers.transmitterId, transmitters.id))
    .where(where);

  // Masked live presence mirrored by the gateway into Redis; offline (or absent) otherwise.
  const presence = new Map<string, string>();
  if (redis && rows.length > 0) {
    try {
      const entries = await redis.hmget('presence', ...rows.map((m: any) => m.transmitterId));
      rows.forEach((m: any, i: number) => entries[i] && presence.set(m.transmitterId, entries[i]));
    } catch {
      /* Redis unavailable: everyone offline */
    }
  }

  const beaconClearances = await db.select().from(clearances).where(eq(clearances.beaconId, beaconId));
  const byId = new Map(beaconClearances.map((c: any) => [c.id, c]));

  return rows.map((m: any) => {
    const held = (m.clearanceIds as string[])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .sort((a: any, b: any) => b.position - a.position) as Array<typeof clearances.$inferSelect>;
    const colored = held.find((c) => c.color && c.color !== '#99AAB5');
    return {
      transmitterId: m.transmitterId,
      user: {
        id: m.transmitterId,
        username: m.username,
        discriminator: m.discriminator,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
        displayColor: m.displayColor,
        displayFont: beacon.suppressCustomFonts ? 'default' : m.displayFont,
        displayNameStyle: m.displayNameStyle,
        staffRank: m.staffRank,
        tagBeaconId: m.tagBeaconId,
        avatarDecoration: m.avatarDecoration,
      },
      // Flat fields kept for existing clients.
      username: m.username,
      discriminator: m.discriminator,
      bio: m.bio,
      bannerUrl: m.bannerUrl,
      bannerColor: m.bannerColor,
      displayName: m.nickname || m.displayName,
      displayColor: colored ? colored.color : m.displayColor,
      displayFont: beacon.suppressCustomFonts ? 'default' : m.displayFont,
      avatarUrl: m.avatarUrl,
      nickname: m.nickname,
      // Per-beacon profile overrides; null means "use the global profile".
      member: { avatarUrl: m.memberAvatarUrl, bannerUrl: m.memberBannerUrl, bio: m.memberBio, pronouns: m.memberPronouns },
      joinedAt: m.joinedAt,
      // Only while it lasts.
      timeoutUntil: m.timeoutUntil && new Date(m.timeoutUntil).getTime() > Date.now() ? m.timeoutUntil : null,
      presence: presence.get(m.transmitterId) || 'offline',
      customStatus: m.customStatus,
      hasCompletedOnboarding: m.hasCompletedOnboarding,
      clearanceIds: m.clearanceIds,
      isOwner: m.transmitterId === beacon.ownerId,
    };
  });
}

export async function buildMember(db: any, redis: any, beaconId: string, transmitterId: string) {
  return (await buildMembers(db, redis, beaconId, [transmitterId]))[0] ?? null;
}
