import { pgTable, text, timestamp, boolean, integer, uuid, jsonb, index } from 'drizzle-orm/pg-core';
import { beacons, transmitters } from './schema.js';

/**
 * Audit Log: what admins and moderators changed in a beacon (Discord's audit log).
 * `changes` is a list of { key, old, new } for updates.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    beaconId: uuid('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
    actorId: uuid('actor_id').references(() => transmitters.id, { onDelete: 'set null' }),
    /** e.g. 'beacon_update', 'relay_create', 'member_ban', 'automod_block'. */
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    /** A name for the target at the time, so deleted ones still read well. */
    targetName: text('target_name'),
    changes: jsonb('changes').$type<Array<{ key: string; old?: unknown; new?: unknown }>>(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('audit_log_beacon_created_idx').on(t.beaconId, t.createdAt)]
);

/**
 * AutoMod rules. Triggers: 'keyword' (keywords / regex), 'spam' (repeated or link-heavy
 * transmissions), 'mention_spam' (too many mentions), 'preset' (built-in word lists).
 * Actions: block the transmission (with an optional custom message), alert a relay, time out.
 */
export const automodRules = pgTable('automod_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  beaconId: uuid('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  trigger: text('trigger').notNull(),
  keywords: jsonb('keywords').$type<string[]>().default([]).notNull(),
  regexes: jsonb('regexes').$type<string[]>().default([]).notNull(),
  allowList: jsonb('allow_list').$type<string[]>().default([]).notNull(),
  /** preset trigger: which lists ('profanity' | 'insults' | 'sexual'). */
  presets: jsonb('presets').$type<string[]>().default([]).notNull(),
  mentionLimit: integer('mention_limit').default(5).notNull(),
  blockMessage: boolean('block_message').default(true).notNull(),
  customMessage: text('custom_message'),
  alertChannelId: uuid('alert_channel_id'),
  timeoutSeconds: integer('timeout_seconds').default(0).notNull(),
  exemptClearanceIds: jsonb('exempt_clearance_ids').$type<string[]>().default([]).notNull(),
  exemptRelayIds: jsonb('exempt_relay_ids').$type<string[]>().default([]).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  creatorId: uuid('creator_id').references(() => transmitters.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Beacon stickers (Discord's server stickers): a PNG/APNG/GIF/WebP image sent on its own. */
export const beaconStickers = pgTable('beacon_stickers', {
  id: uuid('id').defaultRandom().primaryKey(),
  beaconId: uuid('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  /** The emoji it relates to (Discord's sticker tags). */
  emoji: text('emoji').notNull(),
  url: text('url').notNull(),
  creatorId: uuid('creator_id').references(() => transmitters.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Soundboard sounds: short clips members play into a comm-link. */
export const soundboardSounds = pgTable('soundboard_sounds', {
  id: uuid('id').defaultRandom().primaryKey(),
  beaconId: uuid('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  emoji: text('emoji'),
  url: text('url').notNull(),
  /** Playback volume, 0-100. */
  volume: integer('volume_pct').default(100).notNull(),
  creatorId: uuid('creator_id').references(() => transmitters.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Beacon templates: a snapshot of relays, bands and clearances others can start a beacon from. */
export const beaconTemplates = pgTable('beacon_templates', {
  code: text('code').primaryKey(),
  beaconId: uuid('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  snapshot: jsonb('snapshot').$type<TemplateSnapshot>().notNull(),
  creatorId: uuid('creator_id').references(() => transmitters.id, { onDelete: 'set null' }),
  usageCount: integer('usage_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export interface TemplateSnapshot {
  relays: Array<{ key: string; name: string; type: string; topic: string | null; parentKey: string | null; position: number }>;
  clearances: Array<{ name: string; color: string; position: number; permissions: string; hoist: boolean }>;
  settings: { defaultNotifications: string | null; verificationLevel: string; systemChannelKey: string | null; afkChannelKey: string | null; afkTimeout: number };
}
