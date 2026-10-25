import { pgTable, text, timestamp, uuid, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { transmitters } from './schema.js';

/**
 * OAuth2 applications people build on Subspace (User Settings › Developer Applications).
 * Only the hash of the client secret is kept.
 */
export const oauthApps = pgTable(
  'oauth_apps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    iconUrl: text('icon_url'),
    clientSecretHash: text('client_secret_hash').notNull(),
    redirectUris: text('redirect_uris').array().default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('oauth_apps_owner').on(t.ownerId)]
);

/** A transmitter's consent to an app (Authorized Apps), with the scopes they granted. */
export const oauthGrants = pgTable(
  'oauth_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    appId: uuid('app_id').references(() => oauthApps.id, { onDelete: 'cascade' }).notNull(),
    transmitterId: uuid('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('oauth_grants_unique').on(t.appId, t.transmitterId)]
);

/** Access and refresh tokens issued under a grant, stored as SHA-256 hashes. */
export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    grantId: uuid('grant_id').references(() => oauthGrants.id, { onDelete: 'cascade' }).notNull(),
    kind: text('kind').notNull(), // 'access' | 'refresh'
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('oauth_tokens_grant').on(t.grantId)]
);
