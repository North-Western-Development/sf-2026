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
    is2faEnabled: Boolean(user.is2faEnabled),
    isEmailVerified: Boolean(user.isEmailVerified),
    createdAt: user.createdAt,
    tagBeaconId: user.tagBeaconId ?? null,
    defaultAllowDms: user.defaultAllowDms ?? true,
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
  };
}
