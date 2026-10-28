import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  primaryKey,
  jsonb,
} from 'drizzle-orm/pg-core';
import { snowflake, snowflakeId } from './snowflake.js';
import { beacons, relays, transmitters } from './schema.js';

/**
 * Beacon Invites (section 6 of the parity contract)
 */
export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  beaconId: snowflake('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  relayId: snowflake('relay_id').references(() => relays.id, { onDelete: 'set null' }),
  inviterId: snowflake('inviter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  maxUses: integer('max_uses').default(0).notNull(),
  uses: integer('uses').default(0).notNull(),
  maxAgeSeconds: integer('max_age_seconds').default(604800).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  temporary: boolean('temporary').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Beacon Bans
 */
export const beaconBans = pgTable('beacon_bans', {
  beaconId: snowflake('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  reason: text('reason'),
  bannedBy: snowflake('banned_by').references(() => transmitters.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.beaconId, table.transmitterId] }),
]);

/**
 * Private Notes (owner writes a private note about another transmitter)
 */
export const transmitterNotes = pgTable('transmitter_notes', {
  ownerId: snowflake('owner_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  targetId: snowflake('target_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  note: text('note').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.targetId] }),
]);

/**
 * Media Uploads (section 7): tracks every ticketed upload to the public-read
 * `subspace-media` bucket so ownership + completion can be verified before a URL
 * is ever accepted into a profile / beacon / glyph field.
 */
export const mediaUploads = pgTable('media_uploads', {
  id: snowflakeId('id'),
  ownerId: snowflake('owner_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  purpose: text('purpose').notNull(), // avatar | banner | beacon_icon | beacon_banner | glyph | mesh_icon
  mimeType: text('mime_type').notNull(),
  declaredSizeBytes: bigint('declared_size_bytes', { mode: 'bigint' }).notNull(),
  storageKey: text('storage_key').notNull(),
  publicUrl: text('public_url').notNull(),
  verified: boolean('verified').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

/**
 * Onboarding questions (Channels & Roles > Customize). Each option can grant self-service
 * clearances (never elevated ones; the API filters) and show relays in the member's sidebar.
 */
export const onboardingQuestions = pgTable('onboarding_questions', {
  id: snowflakeId('id'),
  beaconId: snowflake('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  /** True: pick any number ("Choose all that apply"); false: pick one. */
  multiple: boolean('multiple').default(true).notNull(),
  required: boolean('required').default(false).notNull(),
  position: integer('position').default(0).notNull(),
});

export const onboardingOptions = pgTable('onboarding_options', {
  id: snowflakeId('id'),
  questionId: snowflake('question_id').references(() => onboardingQuestions.id, { onDelete: 'cascade' }).notNull(),
  beaconId: snowflake('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  label: text('label').notNull(),
  description: text('description'),
  emoji: text('emoji'),
  clearanceIds: jsonb('clearance_ids').$type<string[]>().default([]).notNull(),
  relayIds: jsonb('relay_ids').$type<string[]>().default([]).notNull(),
  position: integer('position').default(0).notNull(),
});

/**
 * A member's own view of a beacon: the onboarding options they picked and the relays they
 * hid from their sidebar (Browse Channels). Hiding never changes permissions.
 */
export const memberBeaconPrefs = pgTable('member_beacon_prefs', {
  beaconId: snowflake('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  selectedOptionIds: jsonb('selected_option_ids').$type<string[]>().default([]).notNull(),
  hiddenRelayIds: jsonb('hidden_relay_ids').$type<string[]>().default([]).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.beaconId, table.transmitterId] }),
]);

/**
 * Scheduled events. Location is a Comm-Link in the beacon or free text elsewhere.
 * Status: scheduled -> active (host starts it) -> completed, or canceled.
 */
export const beaconEvents = pgTable('beacon_events', {
  id: snowflakeId('id'),
  beaconId: snowflake('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  creatorId: snowflake('creator_id').references(() => transmitters.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description'),
  locationType: text('location_type').notNull(), // 'comm_link' | 'stage' | 'external'
  relayId: snowflake('relay_id').references(() => relays.id, { onDelete: 'set null' }),
  location: text('location'),
  coverUrl: text('cover_url'),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }),
  status: text('status').default('scheduled').notNull(),
  /** 'none' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'weekdays'; the next occurrence is created when one ends. */
  recurrence: text('recurrence').default('none').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const eventInterests = pgTable('event_interests', {
  eventId: snowflake('event_id').references(() => beaconEvents.id, { onDelete: 'cascade' }).notNull(),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.eventId, table.transmitterId] }),
]);
