import { pgTable, text, timestamp, index, uniqueIndex, jsonb, primaryKey, integer } from 'drizzle-orm/pg-core';
import { snowflake, snowflakeId } from './snowflake.js';
import { transmitters } from './schema.js';

/**
 * Development teams (Discord's): several people working on the same applications. The owner can
 * do everything; members have a role (DEV_TEAM_ROLES in @subspace/constants) and join by accepting
 * an invitation.
 */
export const devTeams = pgTable('dev_teams', {
  id: snowflakeId('id'),
  name: text('name').notNull(),
  ownerId: snowflake('owner_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const devTeamMembers = pgTable(
  'dev_team_members',
  {
    teamId: snowflake('team_id').references(() => devTeams.id, { onDelete: 'cascade' }).notNull(),
    transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
    /** 'admin' | 'developer' | 'read_only' */
    role: text('role').notNull(),
    /** Null while the invitation is pending. */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    invitedBy: snowflake('invited_by').references(() => transmitters.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.transmitterId] }), index('dev_team_members_user').on(t.transmitterId)]
);

/**
 * OAuth2 applications people build on Subspace (User Settings › Developer Applications).
 * Only the hash of the client secret is kept.
 */
export const oauthApps = pgTable(
  'oauth_apps',
  {
    id: snowflakeId('id'),
    ownerId: snowflake('owner_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    iconUrl: text('icon_url'),
    clientSecretHash: text('client_secret_hash').notNull(),
    redirectUris: text('redirect_uris').array().default([]).notNull(),
    /**
     * The detected game (packages/constants/src/games.json) staff verified this app as. Its icon
     * then stands in for the game's Steam cover in activity status.
     */
    detectedGame: text('detected_game'),
    /** Owned by a development team: its members reach it as their role allows. The owner is then the team's owner. */
    teamId: snowflake('team_id').references(() => devTeams.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('oauth_apps_owner').on(t.ownerId), uniqueIndex('oauth_apps_detected_game').on(t.detectedGame)]
);

/** A transmitter's consent to an app (Authorized Apps), with the scopes they granted. */
export const oauthGrants = pgTable(
  'oauth_grants',
  {
    id: snowflakeId('id'),
    appId: snowflake('app_id').references(() => oauthApps.id, { onDelete: 'cascade' }).notNull(),
    transmitterId: snowflake('transmitter_id').references(() => transmitters.id, { onDelete: 'cascade' }).notNull(),
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
    grantId: snowflake('grant_id').references(() => oauthGrants.id, { onDelete: 'cascade' }).notNull(),
    kind: text('kind').notNull(), // 'access' | 'refresh'
    /** What this token may do: the scopes consented to when it was issued (not later additions to the grant). */
    scopes: jsonb('scopes').$type<string[]>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('oauth_tokens_grant').on(t.grantId)]
);

/**
 * An application's Activity (Discord's Embedded App): a web page people open together inside a
 * comm-link. It runs in a sandboxed iframe on the developer's own https origin and talks to
 * Subspace only through @subspace/activity-sdk (postMessage). One per application.
 *
 * Only the application's team can launch it until staff approve it (Command Console ›
 * Activities); changing the URL takes the approval away again.
 */
export const appActivities = pgTable('app_activities', {
  appId: snowflake('app_id')
    .primaryKey()
    .references(() => oauthApps.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  /** The page to load: https origin + path (http only to localhost outside production). */
  url: text('url').notNull(),
  /** How many people can be in one instance of it at once. */
  maxParticipants: integer('max_participants').default(16).notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: snowflake('approved_by').references(() => transmitters.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
