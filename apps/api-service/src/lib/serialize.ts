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
  };
}
