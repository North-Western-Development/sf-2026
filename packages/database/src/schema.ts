import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  uuid,
  jsonb,
  primaryKey
} from 'drizzle-orm/pg-core';

/**
 * Transmitters (Users/Accounts)
 */
export const transmitters = pgTable('transmitters', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  displayFont: text('display_font').default('default').notNull(),
  displayColor: text('display_color').default('#00F0FF').notNull(),
  bannerColor: text('banner_color').default('#0B0E14').notNull(),
  bannerUrl: text('banner_url'),
  avatarUrl: text('avatar_url'),
  presence: text('presence').default('offline').notNull(),
  staffRank: integer('staff_rank').default(0).notNull(),
  isEmailVerified: boolean('is_email_verified').default(false).notNull(),
  hasAcceptedUploadDisclaimer: boolean('has_accepted_upload_disclaimer').default(false).notNull(),
  lastAgreedRulesVersion: integer('last_agreed_rules_version').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
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
  color: text('color').default('#00F0FF').notNull(),
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
  permissions: bigint('permissions', { mode: 'bigint' }).default(0n).notNull(),
  allowDelegation: boolean('allow_delegation').default(false).notNull(),
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
  allowBits: bigint('allow_bits', { mode: 'bigint' }).default(0n).notNull(),
  denyBits: bigint('deny_bits', { mode: 'bigint' }).default(0n).notNull(),
});

/**
 * Transmissions (Messages)
 */
export const transmissions = pgTable('transmissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  relayId: uuid('relay_id').references(() => relays.id, { onDelete: 'cascade' }).notNull(),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  content: text('content').notNull(), // Max 2000 chars default
  attachments: jsonb('attachments').$type<Array<{ id: string; url: string; filename: string; size: number }>>().default([]).notNull(),
  isEdited: boolean('is_edited').default(false).notNull(),
  encryptedPayload: text('encrypted_payload'),
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
