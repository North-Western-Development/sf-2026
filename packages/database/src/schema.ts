import { sql } from 'drizzle-orm';
import {
  pgTable,
  index,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  primaryKey,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { snowflake, snowflakeId } from './snowflake.js';

/**
 * Storage groups: instance admins put accounts in one to give them their own Vault limits.
 * Accounts outside any group get DEFAULT_STORAGE_QUOTA_MB and DEFAULT_MAX_UPLOAD_MB.
 */
export const storageGroups = pgTable('storage_groups', {
  id: snowflakeId('id'),
  name: text('name').notNull().unique(),
  /** Total Vault storage per member, and the largest single upload. */
  quotaBytes: bigint('quota_bytes', { mode: 'number' }).notNull(),
  maxUploadBytes: bigint('max_upload_bytes', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Staff ranks (Command Console > Staff Ranks). Higher position outranks lower: staff only act on
 * accounts and ranks below their own. The Root rank always has every permission and cannot be
 * deleted. The three built-in ranks carry the legacy staff_rank number (1 Moderator, 2 Admin,
 * 3 Root) they stand for, so accounts with only a staff_rank resolve to them.
 */
export const staffRoles = pgTable('staff_roles', {
  id: snowflakeId('id'),
  name: text('name').notNull(),
  color: text('color').default('#3B8EF2').notNull(),
  position: integer('position').notNull(),
  permissions: integer('permissions').default(0).notNull(),
  isRoot: boolean('is_root').default(false).notNull(),
  legacyRank: integer('legacy_rank').unique(),
  /** Shown on every holder's profile, in place of the generic Staff badge. */
  badgeId: snowflake('badge_id').references((): AnyPgColumn => commendations.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Every action staff take in the Command Console, instance-wide (beacon moderation has its own
 * audit_log). Kept for accountability; it never holds network addresses.
 */
export const staffAuditLog = pgTable('staff_audit_log', {
  id: snowflakeId('id'),
  actorId: snowflake('actor_id').references((): AnyPgColumn => transmitters.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  summary: text('summary').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('staff_audit_log_created_idx').on(table.createdAt)]);

/**
 * Instance-wide settings staff change in the Command Console, one row per key (e.g. 'developers':
 * the DeveloperPolicy in @subspace/constants). A missing row means the defaults.
 */
export const instanceSettings = pgTable('instance_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Transmitters (Users/Accounts)
 */
export const transmitters = pgTable('transmitters', {
  id: snowflakeId('id'),
  username: text('username').notNull(),
  discriminator: text('discriminator').default('0001').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  displayFont: text('display_font').default('default').notNull(),
  displayColor: text('display_color').default('#EEF1FA').notNull(),
  bannerColor: text('banner_color').default('#3353D6').notNull(),
  bannerUrl: text('banner_url'),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),
  presence: text('presence').default('offline').notNull(),
  customStatus: jsonb('custom_status').$type<{ text: string; emoji?: string; expiresAt?: string } | null>(),
  staffRank: integer('staff_rank').default(0).notNull(),
  /** Their staff rank; without one, staff_rank picks the built-in rank (see staffRoles). */
  staffRoleId: snowflake('staff_role_id').references((): AnyPgColumn => staffRoles.id, { onDelete: 'set null' }),
  isBanned: boolean('is_banned').default(false).notNull(),
  banReason: text('ban_reason'),
  isEmailVerified: boolean('is_email_verified').default(false).notNull(),
  emailVerificationCode: text('email_verification_code'),
  totpSecret: text('totp_secret'),
  is2faEnabled: boolean('is_2fa_enabled').default(false).notNull(),
  backupCodes: jsonb('backup_codes').$type<string[]>().default([]).notNull(),
  hasAcceptedUploadDisclaimer: boolean('has_accepted_upload_disclaimer').default(false).notNull(),
  lastAgreedRulesVersion: integer('last_agreed_rules_version').default(0).notNull(),
  tokenVersion: integer('token_version').default(0).notNull(),
  // Discord-parity profile fields (section 9 of the parity contract)
  pronouns: text('pronouns'),
  themePrimary: text('theme_primary'),
  themeAccent: text('theme_accent'),
  displayNameStyle: jsonb('display_name_style').$type<{
    font: string;
    effect: string;
    colors: string[];
  }>(),
  profileVisibility: text('profile_visibility').default('everyone').notNull(), // 'everyone' | 'beacons' | 'friends'
  /** Activity Privacy: who sees what I am playing. Off until turned on. */
  activityVisibility: text('activity_visibility').default('off').notNull(), // 'off' | 'everyone' | 'friends'
  /** What's New: the newest changelog entry they have seen on each platform ({ web, desktop, mobile }). */
  changelogSeen: jsonb('changelog_seen').$type<Partial<Record<'web' | 'desktop' | 'mobile', string>>>().default({}).notNull(),
  // Self-service account removal: disabled accounts reactivate on sign-in; deleted ones are anonymised.
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  /** Staff quarantine: the account can read but not post in beacons, DM non-friends or join beacons. */
  quarantinedAt: timestamp('quarantined_at', { withTimezone: true }),
  quarantineReason: text('quarantine_reason'),
  /** The beacon whose Beacon Tag they wear beside their name (Discord's server tags). */
  tagBeaconId: snowflake('tag_beacon_id'),
  /** A built-in avatar decoration and profile effect (AVATAR_DECORATIONS / PROFILE_EFFECTS), or null. */
  avatarDecoration: text('avatar_decoration'),
  profileEffect: text('profile_effect'),
  /** A verified phone number (E.164), and a pending one waiting for its SMS code. */
  phone: text('phone'),
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
  /** Verified by hand by staff (Command Console › Transmitters); one of the ways an instance can count an account as verified. */
  handVerifiedAt: timestamp('hand_verified_at', { withTimezone: true }),
  phonePending: text('phone_pending'),
  phoneCodeHash: text('phone_code_hash'),
  phoneCodeExpiresAt: timestamp('phone_code_expires_at', { withTimezone: true }),
  /** Privacy: whether members of beacons they join may DM them (each beacon's Privacy Settings starts from this). */
  defaultAllowDms: boolean('default_allow_dms').default(true).notNull(),
  /** Not a person: 'bot' (a Developer Application's bot) or 'webhook' (a webhook's author). */
  botKind: text('bot_kind'),
  /** Their storage group (Command Console), or null for the instance defaults. */
  storageGroupId: snowflake('storage_group_id').references(() => storageGroups.id, { onDelete: 'set null' }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('transmitters_username_discriminator_idx').on(table.username, table.discriminator),
  // A verified number belongs to one account.
  uniqueIndex('transmitters_phone_idx').on(table.phone),
]);

/**
 * Transmitter Passkeys (WebAuthn / FIDO2)
 */
export const transmitterPasskeys = pgTable('transmitter_passkeys', {
  id: snowflakeId('id'),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').default(0).notNull(),
  deviceType: text('device_type').notNull(),
  backedUp: boolean('backed_up').default(false).notNull(),
  transports: jsonb('transports').$type<string[]>().default([]).notNull(),
  name: text('name').default('Passkey').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});


/**
 * Beacons (Servers)
 */
export const beacons = pgTable('beacons', {
  id: snowflakeId('id'),
  name: text('name').notNull(),
  description: text('description'),
  iconUrl: text('icon_url'),
  bannerUrl: text('banner_url'),
  ownerId: snowflake('owner_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  isDiscoverable: boolean('is_discoverable').default(false).notNull(),
  suppressCustomFonts: boolean('suppress_custom_fonts').default(false).notNull(),
  rulesText: text('rules_text'),
  // Engagement (Discord's): system messages go to the system relay.
  systemChannelId: snowflake('system_channel_id'),
  /** A random welcome line when someone joins. */
  welcomeMessages: boolean('welcome_messages').default(true).notNull(),
  /** Welcome lines carry a "Wave to say hi!" button. */
  welcomeWave: boolean('welcome_wave').default(true).notNull(),
  /** A setup checklist for the owner when the beacon is new. */
  setupTips: boolean('setup_tips').default(true).notNull(),
  /** 'all' | 'mentions'; null keeps the size-based default (all under 100 members). */
  defaultNotifications: text('default_notifications'),
  /** Members idle in a comm-link this long (seconds) move to the inactive one, muted. */
  afkChannelId: snowflake('afk_channel_id'),
  afkTimeout: integer('afk_timeout').default(300).notNull(),
  // Safety Setup.
  /** 'none' | 'low' (verified email) | 'medium' (account older than 5 minutes) | 'high' (member for 10 minutes) | 'highest' (two-factor on). */
  verificationLevel: text('verification_level').default('none').notNull(),
  /** Explicit image filter: 'off' | 'members' (members without a clearance) | 'all'. Images are checked on members' devices and blurred. */
  explicitFilter: text('explicit_filter').default('off').notNull(),
  /** Security Actions: joining by invite, and DMs between members who are not affiliates, are paused until then. */
  invitesPausedUntil: timestamp('invites_paused_until', { withTimezone: true }),
  dmsPausedUntil: timestamp('dms_paused_until', { withTimezone: true }),
  /** Beacon Tag: up to 4 characters members can wear beside their name, with an emoji badge. */
  tag: text('tag'),
  tagBadge: text('tag_badge'),
  /** Widget: public JSON and an embeddable card; joins through an invite to this relay. */
  widgetEnabled: boolean('widget_enabled').default(false).notNull(),
  widgetChannelId: snowflake('widget_channel_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Beacon Clusters (User-specific folders in Beacon List)
 */
export const beaconClusters = pgTable('beacon_clusters', {
  id: snowflakeId('id'),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  color: text('color').default('#3B8EF2').notNull(),
  position: integer('position').default(0).notNull(),
  beaconIds: jsonb('beacon_ids').$type<string[]>().default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Clearances (Roles & Permissions in a Beacon)
 */
export const clearances = pgTable('clearances', {
  id: snowflakeId('id'),
  beaconId: snowflake('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  color: text('color').default('#99AAB5').notNull(),
  position: integer('position').notNull(), // Higher = higher rank
  permissions: bigint('permissions', { mode: 'bigint' }).default(sql`0`).notNull(),
  allowDelegation: boolean('allow_delegation').default(false).notNull(),
  hoist: boolean('hoist').default(false).notNull(), // Display members with this role separately in the member list
  /** A bot's own clearance, made when it was added: only removing the bot removes it. */
  managedBy: snowflake('managed_by'),
  /** Anyone may @mention it; otherwise only members with Mention All Clearances. */
  mentionable: boolean('mentionable').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Beacon Members
 */
export const beaconMembers = pgTable('beacon_members', {
  beaconId: snowflake('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  nickname: text('nickname'),
  hasCompletedOnboarding: boolean('has_completed_onboarding').default(false).notNull(),
  clearanceIds: jsonb('clearance_ids').$type<string[]>().default([]).notNull(),
  // Per-beacon profile overrides (section 9); null means "use global profile field"
  avatarUrl: text('avatar_url'),
  bannerUrl: text('banner_url'),
  bio: text('bio'),
  pronouns: text('pronouns'),
  themePrimary: text('theme_primary'),
  themeAccent: text('theme_accent'),
  displayNameStyle: jsonb('display_name_style').$type<{
    font: string;
    effect: string;
    colors: string[];
  }>(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  /** How they joined: 'invite' | 'discovery' | 'owner'; null for members from before this was recorded. */
  joinMethod: text('join_method'),
  /** The invite code used, kept after the invite itself is revoked. */
  joinInviteCode: text('join_invite_code'),
  invitedBy: snowflake('invited_by'),
  /** Timed out until (Discord's timeout): can read, cannot send, react or join voice. */
  timeoutUntil: timestamp('timeout_until', { withTimezone: true }),
  /** Privacy Settings for this beacon (Discord's per-server one): other members may DM you. */
  allowDms: boolean('allow_dms').default(true).notNull(),
  /** First DMs from members who are not affiliates go to Message Requests instead of the DM. */
  messageRequests: boolean('message_requests').default(false).notNull(),
  /** Show which activity you are in to this beacon's members, and let them join it. */
  shareActivity: boolean('share_activity').default(true).notNull(),
  activityJoining: boolean('activity_joining').default(true).notNull(),
  /** Server mute and deafen (moderators with Mute Members): kept until a moderator lifts them. */
  serverMuted: boolean('server_muted').default(false).notNull(),
  serverDeafened: boolean('server_deafened').default(false).notNull(),
}, (table) => [
  primaryKey({ columns: [table.beaconId, table.transmitterId] }),
]);

/**
 * Relays (Channels)
 */
export const relays = pgTable('relays', {
  id: snowflakeId('id'),
  beaconId: snowflake('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  parentId: snowflake('parent_id'), // Frequency Band (Category) ID
  name: text('name').notNull(),
  type: text('type').default('text').notNull(), // text, comm_link, archival, visual
  topic: text('topic'),
  position: integer('position').default(0).notNull(),
  isUnhideable: boolean('is_unhideable').default(false).notNull(),
  lastTransmissionId: snowflake('last_transmission_id'),
  lastTransmissionAt: timestamp('last_transmission_at', { withTimezone: true }),
  permissionsSynced: boolean('permissions_synced').default(true).notNull(),
  /** Seconds each member waits between transmissions here (0 = off); Bypass Slowmode skips it. */
  slowmodeSeconds: integer('slowmode_seconds').default(0).notNull(),
  /** Comm-Links: audio and video are end-to-end encrypted between participants. */
  isE2ee: boolean('is_e2ee').default(false).notNull(),
  /** Text relays: an announcement relay (Discord's), whose published transmissions reach every relay that follows it. */
  isAnnouncement: boolean('is_announcement').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Relay Permission Overwrites
 */
export const relayOverwrites = pgTable('relay_overwrites', {
  id: snowflakeId('id'),
  relayId: snowflake('relay_id').references(() => relays.id, { onDelete: 'cascade' }).notNull(),
  targetId: snowflake('target_id').notNull(), // clearance_id or transmitter_id
  targetType: text('target_type').notNull(), // 'clearance' | 'transmitter'
  allowBits: bigint('allow_bits', { mode: 'bigint' }).default(sql`0`).notNull(),
  denyBits: bigint('deny_bits', { mode: 'bigint' }).default(sql`0`).notNull(),
});

/**
 * Point-to-Point Links (1-on-1 DMs)
 */
export const pointToPointLinks = pgTable('point_to_point_links', {
  id: snowflakeId('id'),
  transmitter1Id: snowflake('transmitter1_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  transmitter2Id: snowflake('transmitter2_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  lastTransmissionId: snowflake('last_transmission_id'),
  lastTransmissionAt: timestamp('last_transmission_at', { withTimezone: true }),
  /** End-to-end encrypted: the server stores and accepts only ciphertext from this point on. */
  encryptedAt: timestamp('encrypted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Subspace Meshes (Group DMs, max 10 members)
 */
export const subspaceMeshes = pgTable('subspace_meshes', {
  id: snowflakeId('id'),
  ownerId: snowflake('owner_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  iconUrl: text('icon_url'),
  lastTransmissionId: snowflake('last_transmission_id'),
  lastTransmissionAt: timestamp('last_transmission_at', { withTimezone: true }),
  /** End-to-end encrypted from this moment on (one-way, like a direct link). */
  encryptedAt: timestamp('encrypted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Subspace Mesh Members
 */
export const subspaceMeshMembers = pgTable('subspace_mesh_members', {
  meshId: snowflake('mesh_id').references(() => subspaceMeshes.id, { onDelete: 'cascade' }).notNull(),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.meshId, table.transmitterId] }),
]);

/**
 * Affiliations (Friend Relationships & Requests with Greeting Notes)
 */
export const affiliations = pgTable('affiliations', {
  id: snowflakeId('id'),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  targetId: snowflake('target_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').default('pending').notNull(), // 'pending' | 'accepted' | 'declined'
  greetingNote: text('greeting_note'), // Optional note up to 200 chars
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Transmission Requests (Direct Message Gate between non-affiliated users sharing a Beacon)
 */
export const transmissionRequests = pgTable('transmission_requests', {
  id: snowflakeId('id'),
  senderId: snowflake('sender_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  recipientId: snowflake('recipient_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  mutualBeaconId: snowflake('mutual_beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  initialTransmission: text('initial_transmission').notNull(),
  status: text('status').default('pending').notNull(), // 'pending' | 'accepted' | 'declined' | 'timed_out'
  /** Flagged as likely spam (Discord's Spam folder): kept out of Requests and its notifications. */
  isSpam: boolean('is_spam').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), // 7 days from creation
});

/**
 * Signal Blacklist (Transmitter, Transmission, or Beacon Block)
 */
export const signalBlacklist = pgTable('signal_blacklist', {
  id: snowflakeId('id'),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  targetId: text('target_id').notNull(), // id of blocked transmitter, transmission, or beacon
  targetType: text('target_type').notNull(), // 'transmitter' | 'transmission' | 'beacon'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Archival Threads (Forum topics in an Archival Relay)
 */
export const archivalThreads = pgTable('archival_threads', {
  id: snowflakeId('id'),
  relayId: snowflake('relay_id').references(() => relays.id, { onDelete: 'cascade' }).notNull(),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]).notNull(),
  isPinned: boolean('is_pinned').default(false).notNull(),
  isLocked: boolean('is_locked').default(false).notNull(),
  /** Text-relay threads: invite-only (Discord's private threads); see threadMembers. */
  isPrivate: boolean('is_private').default(false).notNull(),
  rootTransmissionId: snowflake('root_transmission_id'),
  /** Text-relay threads: the transmission in the relay it was started from (Discord's thread starter). */
  starterTransmissionId: snowflake('starter_transmission_id'),
  transmissionCount: integer('transmission_count').default(0).notNull(),
  lastTransmissionId: snowflake('last_transmission_id'),
  lastTransmissionAt: timestamp('last_transmission_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** One member's vote for one answer of a poll. */
export const pollVotes = pgTable('poll_votes', {
  transmissionId: snowflake('transmission_id').references(() => transmissions.id, { onDelete: 'cascade' }).notNull(),
  answerId: integer('answer_id').notNull(),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  votedAt: timestamp('voted_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmissionId, table.answerId, table.transmitterId] }),
]);

/**
 * Who is in a private thread: its creator and whoever was added. Members with Manage Threads see
 * every private thread without being in it.
 */
export const threadMembers = pgTable('thread_members', {
  threadId: snowflake('thread_id').references(() => archivalThreads.id, { onDelete: 'cascade' }).notNull(),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.threadId, table.transmitterId] }),
]);

/**
 * Transmitter Relay Preferences (Hideable Relays custom filter)
 */
export const transmitterRelayPreferences = pgTable('transmitter_relay_preferences', {
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  relayId: snowflake('relay_id').references(() => relays.id, { onDelete: 'cascade' }).notNull(),
  isHidden: boolean('is_hidden').default(false).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmitterId, table.relayId] }),
]);

export interface TransmissionPoll {
  question: string;
  answers: Array<{ id: number; text: string; emoji?: string | null }>;
  allowMultiselect: boolean;
  expiresAt: string;
  /** Set when its author (or a moderator) ends it early. */
  endedAt?: string | null;
}

/**
 * Transmissions (Messages)
 */
export const transmissions = pgTable('transmissions', {
  id: snowflakeId('id'),
  relayId: snowflake('relay_id').references(() => relays.id, { onDelete: 'cascade' }),
  threadId: snowflake('thread_id').references(() => archivalThreads.id, { onDelete: 'cascade' }),
  p2pLinkId: snowflake('p2p_link_id').references(() => pointToPointLinks.id, { onDelete: 'cascade' }),
  meshId: snowflake('mesh_id').references(() => subspaceMeshes.id, { onDelete: 'cascade' }),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  content: text('content').notNull(), // Max 2000 chars default
  attachments: jsonb('attachments').$type<Array<{ id: string; url: string; filename: string; size: number; mimeType?: string; width?: number; height?: number }>>().default([]).notNull(),
  /** Stickers sent with it (Discord's sticker_items); kept as sent, so a deleted sticker still shows. */
  /** A forwarded transmission (Discord's forwarding): a snapshot of the original and where it came from. */
  forwarded: jsonb('forwarded').$type<{ content: string; attachments: unknown[]; stickers?: unknown[]; createdAt: string; source: { channelType: string; channelId: string; beaconId?: string | null; name?: string | null; transmissionId: string } }>(),
  stickers: jsonb('stickers').$type<Array<{ id: string; name: string; url: string }>>().default([]).notNull(),
  /** A poll (Discord's): its question and answers; votes are in pollVotes. */
  poll: jsonb('poll').$type<TransmissionPoll>(),
  /** A recorded voice message: its one attachment is the audio (Send Voice Messages). */
  isVoiceMessage: boolean('is_voice_message').default(false).notNull(),
  /** Sent by a webhook, which may show its own name and avatar on each message. */
  webhookId: snowflake('webhook_id'),
  authorOverride: jsonb('author_override').$type<{ name: string; avatarUrl: string | null }>(),
  /** In an announcement relay: when it was published to the relays that follow it. */
  publishedAt: timestamp('published_at', { withTimezone: true }),
  /** A copy of a published announcement, posted in a relay that follows it: where it came from. */
  crosspost: jsonb('crosspost').$type<{ beaconId: string; beaconName: string; relayId: string; relayName: string; transmissionId: string }>(),
  /** A bot's answer to a slash command: which command, and who used it. */
  interaction: jsonb('interaction').$type<{ id: string; name: string; userId: string }>(),
  isEdited: boolean('is_edited').default(false).notNull(),
  encryptedPayload: text('encrypted_payload'),
  replyToId: snowflake('reply_to_id'),
  replyPing: boolean('reply_ping').default(true).notNull(),
  pinnedAt: timestamp('pinned_at', { withTimezone: true }),
  pinnedBy: snowflake('pinned_by'),
  mentions: jsonb('mentions').$type<string[]>().default([]).notNull(),
  mentionRoles: jsonb('mention_roles').$type<string[]>().default([]).notNull(),
  mentionEveryone: boolean('mention_everyone').default(false).notNull(),
  /** Link previews, filled in after sending (see apps/api-service/src/lib/embeds.ts). */
  embeds: jsonb('embeds').$type<Array<Record<string, unknown>>>().default([]).notNull(),
  suppressEmbeds: boolean('suppress_embeds').default(false).notNull(),
  type: text('type').default('default').notNull(), // 'default' | 'reply' | 'system_join' | 'system_pin'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Badge checks count a transmitter's transmissions.
  index('transmissions_transmitter_idx').on(table.transmitterId),
]);

/**
 * Commendations (Badges)
 */
export const commendations = pgTable('commendations', {
  id: snowflakeId('id'),
  code: text('code').notNull().unique(), // e.g. 'COMM_LINK_1HR', 'STAFF_MEMBER'
  name: text('name').notNull(),
  description: text('description').notNull(),
  iconUrl: text('icon_url').notNull(),
  criteriaType: text('criteria_type').notNull(), // catalog: 'account_age' | 'voice_minutes' | 'transmissions_sent' | 'staff' | 'early_account'; custom: also 'manual' | 'staff_role'
  threshold: integer('threshold').default(0).notNull(),
  /** Made by staff in the Command Console (code custom_<id>), not part of the built-in catalog. */
  isCustom: boolean('is_custom').default(false).notNull(),
  createdBy: snowflake('created_by').references((): AnyPgColumn => transmitters.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Transmitter Commendations
 */
export const transmitterCommendations = pgTable('transmitter_commendations', {
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  commendationId: snowflake('commendation_id').references(() => commendations.id, { onDelete: 'cascade' }).notNull(),
  displayOrder: integer('display_order').default(0).notNull(),
  isVisible: boolean('is_visible').default(true).notNull(),
  awardedAt: timestamp('awarded_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmitterId, table.commendationId] }),
]);

/**
 * Subspace Vault Files (S3 Objects metadata)
 */
export const vaultFiles = pgTable('vault_files', {
  id: snowflakeId('id'),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  storageKey: text('storage_key').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
  isQuarantined: boolean('is_quarantined').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * End-to-end encryption devices. Only public keys: the identity (ECDH P-256) and signing
 * (ECDSA P-256) keys, and the current signed prekey. Private keys never leave the device.
 */
export const e2eeDevices = pgTable('e2ee_devices', {
  id: snowflakeId('id'),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').default('Device').notNull(),
  identityKey: text('identity_key').notNull(),
  signingKey: text('signing_key').notNull(),
  signedPreKey: jsonb('signed_pre_key').$type<{ id: number; key: string; signature: string }>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
});

/** One-time prekeys; each is handed out once and deleted. */
export const e2eeOneTimePreKeys = pgTable('e2ee_one_time_pre_keys', {
  deviceId: snowflake('device_id').references(() => e2eeDevices.id, { onDelete: 'cascade' }).notNull(),
  keyId: integer('key_id').notNull(),
  publicKey: text('public_key').notNull(),
}, (table) => [
  primaryKey({ columns: [table.deviceId, table.keyId] }),
]);

/** Expo push tokens of the mobile app installs a transmitter is signed in on. */
export const pushTokens = pgTable('push_tokens', {
  token: text('token').primaryKey(),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  platform: text('platform').default('unknown').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Cloud drive connections (Google Drive, OneDrive, Dropbox) for importing into the vault.
 * Tokens are AES-256-GCM encrypted by the file service; never stored or returned in clear.
 */
export const driveConnections = pgTable('drive_connections', {
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  provider: text('provider').notNull(), // 'google' | 'onedrive' | 'dropbox'
  accountLabel: text('account_label'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmitterId, table.provider] }),
]);

/**
 * Connections (User Settings › Connections): other accounts a transmitter linked, shown on
 * their profile unless hidden. Only the public identity is kept, never the provider's tokens.
 */
export const accountConnections = pgTable('account_connections', {
  id: snowflakeId('id'),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  provider: text('provider').notNull(), // 'github' | 'google' | 'microsoft' | 'dropbox' | 'steam'
  providerAccountId: text('provider_account_id').notNull(),
  name: text('name').notNull(),
  url: text('url'),
  visible: boolean('visible').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('account_connections_unique').on(table.transmitterId, table.provider, table.providerAccountId),
]);

/**
 * Incident Reports (Incident Flare)
 */
export const incidentReports = pgTable('incident_reports', {
  id: snowflakeId('id'),
  reporterId: snowflake('reporter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  targetType: text('target_type').notNull(), // 'transmission' | 'transmitter' | 'beacon'
  targetId: text('target_id').notNull(),
  reason: text('reason').notNull(), // 'harassment' | 'spam' | 'malware' | 'illicit_content' | 'other'
  description: text('description'),
  telemetrySnapshot: jsonb('telemetry_snapshot').default({}).notNull(),
  status: text('status').default('open').notNull(), // 'open' | 'investigating' | 'resolved' | 'dismissed'
  resolutionNotes: text('resolution_notes'),
  resolvedByStaffId: snowflake('resolved_by_staff_id').references(() => transmitters.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Beacon Custom Emojis
 */
export const beaconEmojis = pgTable('beacon_emojis', {
  id: snowflakeId('id'),
  beaconId: snowflake('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  uploaderId: snowflake('uploader_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export * from './schema-messaging.js';
export * from './schema-community.js';
export * from './schema-moderation.js';
export * from './schema-oauth.js';
export * from './schema-bots.js';

/**
 * One-time data migrations applied by api-service on boot (see apps/api-service/src/lib/data-migrations.ts).
 */
export const dataMigrations = pgTable('data_migrations', {
  id: text('id').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
});
