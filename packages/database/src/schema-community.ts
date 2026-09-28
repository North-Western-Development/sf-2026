import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  uuid,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { beacons, relays, transmitters } from './schema.js';

/**
 * Beacon Invites (section 6 of the parity contract)
 */
export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  beaconId: uuid('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  relayId: uuid('relay_id').references(() => relays.id, { onDelete: 'set null' }),
  inviterId: uuid('inviter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
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
  beaconId: uuid('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  reason: text('reason'),
  bannedBy: uuid('banned_by').references(() => transmitters.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.beaconId, table.transmitterId] }),
]);

/**
 * Private Notes (owner writes a private note about another transmitter)
 */
export const transmitterNotes = pgTable('transmitter_notes', {
  ownerId: uuid('owner_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  targetId: uuid('target_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
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
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  purpose: text('purpose').notNull(), // avatar | banner | beacon_icon | beacon_banner | glyph | mesh_icon
  mimeType: text('mime_type').notNull(),
  declaredSizeBytes: bigint('declared_size_bytes', { mode: 'bigint' }).notNull(),
  storageKey: text('storage_key').notNull(),
  publicUrl: text('public_url').notNull(),
  verified: boolean('verified').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
