import { pgTable, text, timestamp, index, uniqueIndex, jsonb, bigint, boolean } from 'drizzle-orm/pg-core';
import { snowflake, snowflakeId } from './snowflake.js';
import { transmitters, beacons, relays } from './schema.js';
import { oauthApps } from './schema-oauth.js';

/**
 * Incoming webhooks (Discord's): post into one relay with a secret URL, no account needed. Each
 * has its own hidden transmitter (botKind 'webhook') that its transmissions are written by; a
 * message may still show another name and avatar (transmissions.authorOverride).
 */
export const webhooks = pgTable(
  'webhooks',
  {
    id: snowflakeId('id'),
    beaconId: snowflake('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }).notNull(),
    relayId: snowflake('relay_id').references(() => relays.id, { onDelete: 'cascade' }).notNull(),
    /** The hidden transmitter its transmissions are written by. */
    authorId: snowflake('author_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    tokenHash: text('token_hash').notNull(),
    creatorId: snowflake('creator_id').references(() => transmitters.id, { onDelete: 'set null' }),
    /** A follower webhook: this relay follows that announcement relay and gets what it publishes. */
    sourceRelayId: snowflake('source_relay_id').references(() => relays.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('webhooks_relay').on(t.relayId), index('webhooks_source_relay').on(t.sourceRelayId)]
);

/**
 * A Developer Application's bot (Discord's): its own account (botKind 'bot'), a token it signs in
 * with, and how it receives interactions. One per app.
 */
export const appBots = pgTable('app_bots', {
  appId: snowflake('app_id').primaryKey().references(() => oauthApps.id, { onDelete: 'cascade' }),
  userId: snowflake('user_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull().unique(),
  tokenHash: text('token_hash').notNull().unique(),
  /** Anyone may add it to their beacon; otherwise only the app's owner. */
  isPublic: boolean('is_public').default(false).notNull(),
  /** The privileged Message Content intent: without it the bot sees content only where it is mentioned. */
  messageContent: boolean('message_content').default(false).notNull(),
  /** The privileged Activity Status intent: without it the bot sees nobody's activity (what they are playing). */
  activityIntent: boolean('activity_intent').default(false).notNull(),
  /** Interactions go here by signed HTTP POST when set; otherwise over the gateway. */
  interactionsUrl: text('interactions_url'),
  /** Ed25519 key pair: the public half is shown to the developer, the private half (encrypted) signs requests. */
  publicKey: text('public_key').notNull(),
  privateKeyEnc: text('private_key_enc').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export interface CommandOption {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'user' | 'relay' | 'clearance';
  name: string;
  description: string;
  required?: boolean;
  choices?: Array<{ name: string; value: string | number }>;
}

/** Slash commands an app registers: everywhere it is (beaconId null) or in one beacon. */
export const appCommands = pgTable(
  'app_commands',
  {
    id: snowflakeId('id'),
    appId: snowflake('app_id').references(() => oauthApps.id, { onDelete: 'cascade' }).notNull(),
    beaconId: snowflake('beacon_id').references(() => beacons.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    options: jsonb('options').$type<CommandOption[]>().default([]).notNull(),
    /** Who may use it by default: a permission bitfield they must hold (null: anyone). */
    defaultMemberPermissions: bigint('default_member_permissions', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('app_commands_unique').on(t.appId, t.beaconId, t.name)]
);
