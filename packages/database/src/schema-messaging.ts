import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { snowflake, snowflakeId } from './snowflake.js';
import { transmitters } from './schema.js';

/**
 * Transmission Reactions (emoji reactions on a message)
 */
export const transmissionReactions = pgTable('transmission_reactions', {
  transmissionId: snowflake('transmission_id').notNull(),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  emojiKey: text('emoji_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmissionId, table.transmitterId, table.emojiKey] }),
]);

/**
 * Read State (per transmitter, per channel)
 */
export const readStates = pgTable('read_states', {
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  channelType: text('channel_type').notNull(), // 'relay' | 'link' | 'mesh' | 'thread'
  channelId: snowflake('channel_id').notNull(),
  lastReadId: snowflake('last_read_id'),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  mentionCount: integer('mention_count').default(0).notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmitterId, table.channelType, table.channelId] }),
]);

/**
 * Notification Settings (per transmitter, per scope)
 */
export const notificationSettings = pgTable('notification_settings', {
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  scopeType: text('scope_type').notNull(), // 'global' | 'beacon' | 'category' | 'relay' | 'link' | 'mesh'
  scopeId: text('scope_id').notNull(), // snowflake or '@global'
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
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  linkId: snowflake('link_id').notNull(),
  hiddenAt: timestamp('hidden_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmitterId, table.linkId] }),
]);

/**
 * Bookmarks (Discord's): transmissions someone saved for later, shown in their Inbox. The
 * transmission is checked against what they can still see each time the list is read.
 */
export const bookmarks = pgTable('bookmarks', {
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  transmissionId: snowflake('transmission_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.transmitterId, table.transmissionId] }),
]);

/**
 * Reminders (Discord's "Remind me"): a transmission to come back to at a time. The API tells
 * their devices when one is due (REMINDER_DUE) and it waits in the Inbox until they mark it done.
 */
export const reminders = pgTable('reminders', {
  id: snowflakeId('id'),
  transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  transmissionId: snowflake('transmission_id').notNull(),
  remindAt: timestamp('remind_at', { withTimezone: true }).notNull(),
  /** When their devices were told it is due. */
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  doneAt: timestamp('done_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('reminders_transmitter').on(table.transmitterId),
  index('reminders_due').on(table.remindAt),
]);
