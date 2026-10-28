/** +15550100199 -> +1 ******0199: settings show only the last four digits. */
export const maskPhone = (phone: string) => phone.slice(0, 2) + ' ' + '*'.repeat(Math.max(0, phone.length - 6)) + phone.slice(-4);

/** Shape returned for `transmitter` in auth/profile responses (never includes passwordHash, totpSecret, etc). */
export function serializeTransmitter(user: any) {
  return {
    id: user.id,
    username: user.username,
    discriminator: user.discriminator,
    email: user.email,
    displayName: user.displayName,
    displayColor: user.displayColor,
    displayFont: user.displayFont,
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl,
    bannerColor: user.bannerColor,
    bio: user.bio,
    staffRank: user.staffRank,
    pronouns: user.pronouns ?? null,
    themePrimary: user.themePrimary ?? null,
    themeAccent: user.themeAccent ?? null,
    displayNameStyle: user.displayNameStyle ?? null,
    customStatus: user.customStatus ?? null,
    profileVisibility: user.profileVisibility || 'everyone',
    activityVisibility: user.activityVisibility || 'off',
    changelogSeen: user.changelogSeen ?? {},
    is2faEnabled: Boolean(user.is2faEnabled),
    isEmailVerified: Boolean(user.isEmailVerified),
    createdAt: user.createdAt,
    tagBeaconId: user.tagBeaconId ?? null,
    defaultAllowDms: user.defaultAllowDms ?? true,
    avatarDecoration: user.avatarDecoration ?? null,
    profileEffect: user.profileEffect ?? null,
    phone: user.phone ? maskPhone(user.phone) : null,
  };
}

/** What other people may see of a transmitter (never email, security or privacy settings). */
export function serializePublicTransmitter(user: any) {
  const full = serializeTransmitter(user);
  return {
    id: full.id,
    username: full.username,
    discriminator: full.discriminator,
    displayName: full.displayName,
    displayColor: full.displayColor,
    displayFont: full.displayFont,
    avatarUrl: full.avatarUrl,
    bannerUrl: full.bannerUrl,
    bannerColor: full.bannerColor,
    bio: full.bio,
    staffRank: full.staffRank,
    pronouns: full.pronouns,
    themePrimary: full.themePrimary,
    themeAccent: full.themeAccent,
    displayNameStyle: full.displayNameStyle,
    customStatus: full.customStatus,
    tagBeaconId: full.tagBeaconId,
    avatarDecoration: full.avatarDecoration,
    profileEffect: full.profileEffect,
  };
}
