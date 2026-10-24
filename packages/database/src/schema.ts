import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  uuid,
  jsonb,
  primaryKey,
  uniqueIndex
} from 'drizzle-orm/pg-core';

/**
 * Transmitters (Users/Accounts)
 */
export const transmitters = pgTable('transmitters', {
  id: uuid('id').defaultRandom().primaryKey(),
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
  // Self-service account removal: disabled accounts reactivate on sign-in; deleted ones are anonymised.
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('transmitters_username_discriminator_idx').on(table.username, table.discriminator),
]);

/**
 * Transmitter Passkeys (WebAuthn / FIDO2)
 */
export const transmitterPasskeys = pgTable('transmitter_passkeys', {
  id: uuid('id').defaultRandom().primaryKey(),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
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
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  iconUrl: text('icon_url'),
  bannerUrl: text('banner_url'),
  ownerId: uuid('owner_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  isDiscoverable: boolean('is_discoverable').default(false).notNull(),
  suppressCustomFonts: boolean('suppress_custom_fonts').default(false).notNull(),
  rulesText: text('rules_text'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Beacon Clusters (User-specific folders in Beacon List)
 */
export const beaconClusters = pgTable('beacon_clusters', {
  id: uuid('id').defaultRandom().primaryKey(),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
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
  id: uuid('id').defaultRandom().primaryKey(),
  beaconId: uuid('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  color: text('color').default('#99AAB5').notNull(),
  position: integer('position').notNull(), // Higher = higher rank
  permissions: bigint('permissions', { mode: 'bigint' }).default(sql`0`).notNull(),
  allowDelegation: boolean('allow_delegation').default(false).notNull(),
  hoist: boolean('hoist').default(false).notNull(), // Display members with this role separately in the member list
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Beacon Members
 */
export const beaconMembers = pgTable('beacon_members', {
  beaconId: uuid('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
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
}, (table) => [
  primaryKey({ columns: [table.beaconId, table.transmitterId] }),
]);

/**
 * Relays (Channels)
 */
export const relays = pgTable('relays', {
  id: uuid('id').defaultRandom().primaryKey(),
  beaconId: uuid('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  parentId: uuid('parent_id'), // Frequency Band (Category) ID
  name: text('name').notNull(),
  type: text('type').default('text').notNull(), // text, comm_link, archival, visual
  topic: text('topic'),
  position: integer('position').default(0).notNull(),
  isUnhideable: boolean('is_unhideable').default(false).notNull(),
  lastTransmissionId: uuid('last_transmission_id'),
  lastTransmissionAt: timestamp('last_transmission_at', { withTimezone: true }),
  permissionsSynced: boolean('permissions_synced').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Relay Permission Overwrites
 */
export const relayOverwrites = pgTable('relay_overwrites', {
  id: uuid('id').defaultRandom().primaryKey(),
  relayId: uuid('relay_id').references(() => relays.id, { onDelete: 'cascade' }).notNull(),
  targetId: uuid('target_id').notNull(), // clearance_id or transmitter_id
  targetType: text('target_type').notNull(), // 'clearance' | 'transmitter'
  allowBits: bigint('allow_bits', { mode: 'bigint' }).default(sql`0`).notNull(),
  denyBits: bigint('deny_bits', { mode: 'bigint' }).default(sql`0`).notNull(),
});

/**
 * Point-to-Point Links (1-on-1 DMs)
 */
export const pointToPointLinks = pgTable('point_to_point_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  transmitter1Id: uuid('transmitter1_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  transmitter2Id: uuid('transmitter2_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  lastTransmissionId: uuid('last_transmission_id'),
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
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  iconUrl: text('icon_url'),
  lastTransmissionId: uuid('last_transmission_id'),
  lastTransmissionAt: timestamp('last_transmission_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Subspace Mesh Members
 */
export const subspaceMeshMembers = pgTable('subspace_mesh_members', {
  meshId: uuid('mesh_id').references(() => subspaceMeshes.id, { onDelete: 'cascade' }).notNull(),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.meshId, table.transmitterId] }),
]);

/**
 * Affiliations (Friend Relationships & Requests with Greeting Notes)
 */
export const affiliations = pgTable('affiliations', {
  id: uuid('id').defaultRandom().primaryKey(),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  targetId: uuid('target_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').default('pending').notNull(), // 'pending' | 'accepted' | 'declined'
  greetingNote: text('greeting_note'), // Optional note up to 200 chars
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Transmission Requests (Direct Message Gate between non-affiliated users sharing a Beacon)
 */
export const transmissionRequests = pgTable('transmission_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  senderId: uuid('sender_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  recipientId: uuid('recipient_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  mutualBeaconId: uuid('mutual_beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  initialTransmission: text('initial_transmission').notNull(),
  status: text('status').default('pending').notNull(), // 'pending' | 'accepted' | 'declined' | 'timed_out'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), // 7 days from creation
});

/**
 * Signal Blacklist (Transmitter, Transmission, or Beacon Block)
 */
export const signalBlacklist = pgTable('signal_blacklist', {
  id: uuid('id').defaultRandom().primaryKey(),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  targetId: text('target_id').notNull(), // UUID of blocked transmitter, transmission, or beacon
  targetType: text('target_type').notNull(), // 'transmitter' | 'transmission' | 'beacon'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Archival Threads (Forum topics in an Archival Relay)
 */
export const archivalThreads = pgTable('archival_threads', {
  id: uuid('id').defaultRandom().primaryKey(),
  relayId: uuid('relay_id').references(() => relays.id, { onDelete: 'cascade' }).notNull(),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]).notNull(),
  isPinned: boolean('is_pinned').default(false).notNull(),
  isLocked: boolean('is_locked').default(false).notNull(),
  rootTransmissionId: uuid('root_transmission_id'),
  transmissionCount: integer('transmission_count').default(0).notNull(),
  lastTransmissionId: uuid('last_transmission_id'),
  lastTransmissionAt: timestamp('last_transmission_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Transmitter Relay Preferences (Hideable Relays custom filter)
 */
export const transmitterRelayPreferences = pgTable('transmitter_relay_preferences', {
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  relayId: uuid('relay_id').references(() => relays.id, { onDelete: 'cascade' }).notNull(),
  isHidden: boolean('is_hidden').default(false).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmitterId, table.relayId] }),
]);

/**
 * Transmissions (Messages)
 */
export const transmissions = pgTable('transmissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  relayId: uuid('relay_id').references(() => relays.id, { onDelete: 'cascade' }),
  threadId: uuid('thread_id').references(() => archivalThreads.id, { onDelete: 'cascade' }),
  p2pLinkId: uuid('p2p_link_id').references(() => pointToPointLinks.id, { onDelete: 'cascade' }),
  meshId: uuid('mesh_id').references(() => subspaceMeshes.id, { onDelete: 'cascade' }),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  content: text('content').notNull(), // Max 2000 chars default
  attachments: jsonb('attachments').$type<Array<{ id: string; url: string; filename: string; size: number; mimeType?: string; width?: number; height?: number }>>().default([]).notNull(),
  isEdited: boolean('is_edited').default(false).notNull(),
  encryptedPayload: text('encrypted_payload'),
  replyToId: uuid('reply_to_id'),
  replyPing: boolean('reply_ping').default(true).notNull(),
  pinnedAt: timestamp('pinned_at', { withTimezone: true }),
  pinnedBy: uuid('pinned_by'),
  mentions: jsonb('mentions').$type<string[]>().default([]).notNull(),
  mentionRoles: jsonb('mention_roles').$type<string[]>().default([]).notNull(),
  mentionEveryone: boolean('mention_everyone').default(false).notNull(),
  /** Link previews, filled in after sending (see apps/api-service/src/lib/embeds.ts). */
  embeds: jsonb('embeds').$type<Array<Record<string, unknown>>>().default([]).notNull(),
  suppressEmbeds: boolean('suppress_embeds').default(false).notNull(),
  type: text('type').default('default').notNull(), // 'default' | 'reply' | 'system_join' | 'system_pin'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Commendations (Badges)
 */
export const commendations = pgTable('commendations', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(), // e.g. 'COMM_LINK_1HR', 'STAFF_MEMBER'
  name: text('name').notNull(),
  description: text('description').notNull(),
  iconUrl: text('icon_url').notNull(),
  criteriaType: text('criteria_type').notNull(), // 'account_age' | 'voice_minutes' | 'screenshare_minutes' | 'transmissions_sent' | 'staff'
  threshold: integer('threshold').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Transmitter Commendations
 */
export const transmitterCommendations = pgTable('transmitter_commendations', {
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  commendationId: uuid('commendation_id').references(() => commendations.id, { onDelete: 'cascade' }).notNull(),
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
  id: uuid('id').defaultRandom().primaryKey(),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
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
  id: uuid('id').defaultRandom().primaryKey(),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').default('Device').notNull(),
  identityKey: text('identity_key').notNull(),
  signingKey: text('signing_key').notNull(),
  signedPreKey: jsonb('signed_pre_key').$type<{ id: number; key: string; signature: string }>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
});

/** One-time prekeys; each is handed out once and deleted. */
export const e2eeOneTimePreKeys = pgTable('e2ee_one_time_pre_keys', {
  deviceId: uuid('device_id').references(() => e2eeDevices.id, { onDelete: 'cascade' }).notNull(),
  keyId: integer('key_id').notNull(),
  publicKey: text('public_key').notNull(),
}, (table) => [
  primaryKey({ columns: [table.deviceId, table.keyId] }),
]);

/**
 * Cloud drive connections (Google Drive, OneDrive, Dropbox) for importing into the vault.
 * Tokens are AES-256-GCM encrypted by the file service; never stored or returned in clear.
 */
export const driveConnections = pgTable('drive_connections', {
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
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
 * Incident Reports (Incident Flare)
 */
export const incidentReports = pgTable('incident_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  reporterId: uuid('reporter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  targetType: text('target_type').notNull(), // 'transmission' | 'transmitter' | 'beacon'
  targetId: text('target_id').notNull(),
  reason: text('reason').notNull(), // 'harassment' | 'spam' | 'malware' | 'illicit_content' | 'other'
  description: text('description'),
  telemetrySnapshot: jsonb('telemetry_snapshot').default({}).notNull(),
  status: text('status').default('open').notNull(), // 'open' | 'investigating' | 'resolved' | 'dismissed'
  resolutionNotes: text('resolution_notes'),
  resolvedByStaffId: uuid('resolved_by_staff_id').references(() => transmitters.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Beacon Custom Emojis
 */
export const beaconEmojis = pgTable('beacon_emojis', {
  id: uuid('id').defaultRandom().primaryKey(),
  beaconId: uuid('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  uploaderId: uuid('uploader_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export * from './schema-messaging.js';
export * from './schema-community.js';

/**
 * One-time data migrations applied by api-service on boot (see apps/api-service/src/lib/data-migrations.ts).
 */
export const dataMigrations = pgTable('data_migrations', {
  id: text('id').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
});
