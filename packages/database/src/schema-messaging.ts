import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { transmitters } from './schema.js';

/**
 * Transmission Reactions (emoji reactions on a message)
 */
export const transmissionReactions = pgTable('transmission_reactions', {
  transmissionId: uuid('transmission_id').notNull(),
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  emojiKey: text('emoji_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmissionId, table.transmitterId, table.emojiKey] }),
]);

/**
 * Read State (per transmitter, per channel)
 */
export const readStates = pgTable('read_states', {
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  channelType: text('channel_type').notNull(), // 'relay' | 'link' | 'mesh' | 'thread'
  channelId: uuid('channel_id').notNull(),
  lastReadId: uuid('last_read_id'),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  mentionCount: integer('mention_count').default(0).notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmitterId, table.channelType, table.channelId] }),
]);

/**
 * Notification Settings (per transmitter, per scope)
 */
export const notificationSettings = pgTable('notification_settings', {
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  scopeType: text('scope_type').notNull(), // 'global' | 'beacon' | 'category' | 'relay' | 'link' | 'mesh'
  scopeId: text('scope_id').notNull(), // uuid or '@global'
  level: text('level').default('inherit').notNull(), // 'all' | 'mentions' | 'nothing' | 'inherit'
  mutedUntil: timestamp('muted_until', { withTimezone: true }),
  suppressEveryone: boolean('suppress_everyone').default(false).notNull(),
  suppressRoles: boolean('suppress_roles').default(false).notNull(),
  suppressHighlights: boolean('suppress_highlights').default(false).notNull(),
  mobilePush: boolean('mobile_push').default(true).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmitterId, table.scopeType, table.scopeId] }),
]);

/**
 * Point-to-Point Link Hidden (per-user DM list hiding; a new message un-hides it)
 */
export const pointToPointLinkHidden = pgTable('point_to_point_link_hidden', {
  transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  linkId: uuid('link_id').notNull(),
  hiddenAt: timestamp('hidden_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmitterId, table.linkId] }),
]);
