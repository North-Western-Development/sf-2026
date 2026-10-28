-- Snowflake IDs for rows inserted with plain SQL (the app makes its own; see src/snowflake.ts).
-- Same layout: milliseconds since 2026-01-01 << 22 | worker 1023 (reserved for the database) << 12 | sequence.
CREATE SEQUENCE IF NOT EXISTS "subspace_snowflake_seq" MINVALUE 0 MAXVALUE 4095 START 0 CYCLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION subspace_snowflake() RETURNS bigint LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint - 1767225600000;
BEGIN
  RETURN (ms << 22) | (1023::bigint << 12) | nextval('subspace_snowflake_seq');
END;
$$;
--> statement-breakpoint
CREATE TABLE "account_connections" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliations" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"target_id" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"greeting_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archival_threads" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"relay_id" bigint NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"title" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"root_transmission_id" bigint,
	"starter_transmission_id" bigint,
	"transmission_count" integer DEFAULT 0 NOT NULL,
	"last_transmission_id" bigint,
	"last_transmission_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beacon_clusters" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#3B8EF2' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"beacon_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beacon_emojis" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"beacon_id" bigint NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"uploader_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beacon_members" (
	"beacon_id" bigint NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"nickname" text,
	"has_completed_onboarding" boolean DEFAULT false NOT NULL,
	"clearance_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avatar_url" text,
	"banner_url" text,
	"bio" text,
	"pronouns" text,
	"theme_primary" text,
	"theme_accent" text,
	"display_name_style" jsonb,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"join_method" text,
	"join_invite_code" text,
	"invited_by" bigint,
	"timeout_until" timestamp with time zone,
	"allow_dms" boolean DEFAULT true NOT NULL,
	"message_requests" boolean DEFAULT false NOT NULL,
	"share_activity" boolean DEFAULT true NOT NULL,
	"activity_joining" boolean DEFAULT true NOT NULL,
	"server_muted" boolean DEFAULT false NOT NULL,
	"server_deafened" boolean DEFAULT false NOT NULL,
	CONSTRAINT "beacon_members_beacon_id_transmitter_id_pk" PRIMARY KEY("beacon_id","transmitter_id")
);
--> statement-breakpoint
CREATE TABLE "beacons" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon_url" text,
	"banner_url" text,
	"owner_id" bigint NOT NULL,
	"is_discoverable" boolean DEFAULT false NOT NULL,
	"suppress_custom_fonts" boolean DEFAULT false NOT NULL,
	"rules_text" text,
	"system_channel_id" bigint,
	"welcome_messages" boolean DEFAULT true NOT NULL,
	"welcome_wave" boolean DEFAULT true NOT NULL,
	"setup_tips" boolean DEFAULT true NOT NULL,
	"default_notifications" text,
	"afk_channel_id" bigint,
	"afk_timeout" integer DEFAULT 300 NOT NULL,
	"verification_level" text DEFAULT 'none' NOT NULL,
	"explicit_filter" text DEFAULT 'off' NOT NULL,
	"invites_paused_until" timestamp with time zone,
	"dms_paused_until" timestamp with time zone,
	"tag" text,
	"tag_badge" text,
	"widget_enabled" boolean DEFAULT false NOT NULL,
	"widget_channel_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clearances" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"beacon_id" bigint NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#99AAB5' NOT NULL,
	"position" integer NOT NULL,
	"permissions" bigint DEFAULT 0 NOT NULL,
	"allow_delegation" boolean DEFAULT false NOT NULL,
	"hoist" boolean DEFAULT false NOT NULL,
	"managed_by" bigint,
	"mentionable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commendations" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon_url" text NOT NULL,
	"criteria_type" text NOT NULL,
	"threshold" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commendations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "data_migrations" (
	"id" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_connections" (
	"transmitter_id" bigint NOT NULL,
	"provider" text NOT NULL,
	"account_label" text,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_connections_transmitter_id_provider_pk" PRIMARY KEY("transmitter_id","provider")
);
--> statement-breakpoint
CREATE TABLE "e2ee_devices" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"name" text DEFAULT 'Device' NOT NULL,
	"identity_key" text NOT NULL,
	"signing_key" text NOT NULL,
	"signed_pre_key" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "e2ee_one_time_pre_keys" (
	"device_id" bigint NOT NULL,
	"key_id" integer NOT NULL,
	"public_key" text NOT NULL,
	CONSTRAINT "e2ee_one_time_pre_keys_device_id_key_id_pk" PRIMARY KEY("device_id","key_id")
);
--> statement-breakpoint
CREATE TABLE "incident_reports" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"reporter_id" bigint NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"description" text,
	"telemetry_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_notes" text,
	"resolved_by_staff_id" bigint,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_to_point_links" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"transmitter1_id" bigint NOT NULL,
	"transmitter2_id" bigint NOT NULL,
	"last_transmission_id" bigint,
	"last_transmission_at" timestamp with time zone,
	"encrypted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"transmission_id" bigint NOT NULL,
	"answer_id" integer NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"voted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_transmission_id_answer_id_transmitter_id_pk" PRIMARY KEY("transmission_id","answer_id","transmitter_id")
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"platform" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relay_overwrites" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"relay_id" bigint NOT NULL,
	"target_id" bigint NOT NULL,
	"target_type" text NOT NULL,
	"allow_bits" bigint DEFAULT 0 NOT NULL,
	"deny_bits" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relays" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"beacon_id" bigint NOT NULL,
	"parent_id" bigint,
	"name" text NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"topic" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_unhideable" boolean DEFAULT false NOT NULL,
	"last_transmission_id" bigint,
	"last_transmission_at" timestamp with time zone,
	"permissions_synced" boolean DEFAULT true NOT NULL,
	"slowmode_seconds" integer DEFAULT 0 NOT NULL,
	"is_e2ee" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_blacklist" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"target_id" text NOT NULL,
	"target_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_groups" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"name" text NOT NULL,
	"quota_bytes" bigint NOT NULL,
	"max_upload_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "subspace_mesh_members" (
	"mesh_id" bigint NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subspace_mesh_members_mesh_id_transmitter_id_pk" PRIMARY KEY("mesh_id","transmitter_id")
);
--> statement-breakpoint
CREATE TABLE "subspace_meshes" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"owner_id" bigint NOT NULL,
	"name" text NOT NULL,
	"icon_url" text,
	"last_transmission_id" bigint,
	"last_transmission_at" timestamp with time zone,
	"encrypted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_members" (
	"thread_id" bigint NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_members_thread_id_transmitter_id_pk" PRIMARY KEY("thread_id","transmitter_id")
);
--> statement-breakpoint
CREATE TABLE "transmission_requests" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"sender_id" bigint NOT NULL,
	"recipient_id" bigint NOT NULL,
	"mutual_beacon_id" bigint NOT NULL,
	"initial_transmission" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_spam" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transmissions" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"relay_id" bigint,
	"thread_id" bigint,
	"p2p_link_id" bigint,
	"mesh_id" bigint,
	"transmitter_id" bigint NOT NULL,
	"content" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"forwarded" jsonb,
	"stickers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"poll" jsonb,
	"is_voice_message" boolean DEFAULT false NOT NULL,
	"webhook_id" bigint,
	"author_override" jsonb,
	"interaction" jsonb,
	"is_edited" boolean DEFAULT false NOT NULL,
	"encrypted_payload" text,
	"reply_to_id" bigint,
	"reply_ping" boolean DEFAULT true NOT NULL,
	"pinned_at" timestamp with time zone,
	"pinned_by" bigint,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mention_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mention_everyone" boolean DEFAULT false NOT NULL,
	"embeds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suppress_embeds" boolean DEFAULT false NOT NULL,
	"type" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transmitter_commendations" (
	"transmitter_id" bigint NOT NULL,
	"commendation_id" bigint NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transmitter_commendations_transmitter_id_commendation_id_pk" PRIMARY KEY("transmitter_id","commendation_id")
);
--> statement-breakpoint
CREATE TABLE "transmitter_passkeys" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"name" text DEFAULT 'Passkey' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transmitter_passkeys_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "transmitter_relay_preferences" (
	"transmitter_id" bigint NOT NULL,
	"relay_id" bigint NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transmitter_relay_preferences_transmitter_id_relay_id_pk" PRIMARY KEY("transmitter_id","relay_id")
);
--> statement-breakpoint
CREATE TABLE "transmitters" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"username" text NOT NULL,
	"discriminator" text DEFAULT '0001' NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"display_font" text DEFAULT 'default' NOT NULL,
	"display_color" text DEFAULT '#EEF1FA' NOT NULL,
	"banner_color" text DEFAULT '#3353D6' NOT NULL,
	"banner_url" text,
	"avatar_url" text,
	"bio" text,
	"presence" text DEFAULT 'offline' NOT NULL,
	"custom_status" jsonb,
	"staff_rank" integer DEFAULT 0 NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"is_email_verified" boolean DEFAULT false NOT NULL,
	"email_verification_code" text,
	"totp_secret" text,
	"is_2fa_enabled" boolean DEFAULT false NOT NULL,
	"backup_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_accepted_upload_disclaimer" boolean DEFAULT false NOT NULL,
	"last_agreed_rules_version" integer DEFAULT 0 NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"pronouns" text,
	"theme_primary" text,
	"theme_accent" text,
	"display_name_style" jsonb,
	"profile_visibility" text DEFAULT 'everyone' NOT NULL,
	"disabled_at" timestamp with time zone,
	"quarantined_at" timestamp with time zone,
	"quarantine_reason" text,
	"tag_beacon_id" bigint,
	"avatar_decoration" text,
	"profile_effect" text,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"phone_pending" text,
	"phone_code_hash" text,
	"phone_code_expires_at" timestamp with time zone,
	"default_allow_dms" boolean DEFAULT true NOT NULL,
	"bot_kind" text,
	"storage_group_id" bigint,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transmitters_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vault_files" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"is_quarantined" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"transmitter_id" bigint NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"level" text DEFAULT 'inherit' NOT NULL,
	"muted_until" timestamp with time zone,
	"suppress_everyone" boolean DEFAULT false NOT NULL,
	"suppress_roles" boolean DEFAULT false NOT NULL,
	"suppress_highlights" boolean DEFAULT false NOT NULL,
	"mobile_push" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_transmitter_id_scope_type_scope_id_pk" PRIMARY KEY("transmitter_id","scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE "point_to_point_link_hidden" (
	"transmitter_id" bigint NOT NULL,
	"link_id" bigint NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_to_point_link_hidden_transmitter_id_link_id_pk" PRIMARY KEY("transmitter_id","link_id")
);
--> statement-breakpoint
CREATE TABLE "read_states" (
	"transmitter_id" bigint NOT NULL,
	"channel_type" text NOT NULL,
	"channel_id" bigint NOT NULL,
	"last_read_id" bigint,
	"last_read_at" timestamp with time zone,
	"mention_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "read_states_transmitter_id_channel_type_channel_id_pk" PRIMARY KEY("transmitter_id","channel_type","channel_id")
);
--> statement-breakpoint
CREATE TABLE "transmission_reactions" (
	"transmission_id" bigint NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"emoji_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transmission_reactions_transmission_id_transmitter_id_emoji_key_pk" PRIMARY KEY("transmission_id","transmitter_id","emoji_key")
);
--> statement-breakpoint
CREATE TABLE "beacon_bans" (
	"beacon_id" bigint NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"reason" text,
	"banned_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beacon_bans_beacon_id_transmitter_id_pk" PRIMARY KEY("beacon_id","transmitter_id")
);
--> statement-breakpoint
CREATE TABLE "beacon_events" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"beacon_id" bigint NOT NULL,
	"creator_id" bigint,
	"name" text NOT NULL,
	"description" text,
	"location_type" text NOT NULL,
	"relay_id" bigint,
	"location" text,
	"cover_url" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_interests" (
	"event_id" bigint NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_interests_event_id_transmitter_id_pk" PRIMARY KEY("event_id","transmitter_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"beacon_id" bigint NOT NULL,
	"relay_id" bigint,
	"inviter_id" bigint NOT NULL,
	"max_uses" integer DEFAULT 0 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"max_age_seconds" integer DEFAULT 604800 NOT NULL,
	"expires_at" timestamp with time zone,
	"temporary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_uploads" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"owner_id" bigint NOT NULL,
	"purpose" text NOT NULL,
	"mime_type" text NOT NULL,
	"declared_size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"public_url" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "member_beacon_prefs" (
	"beacon_id" bigint NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"selected_option_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hidden_relay_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_beacon_prefs_beacon_id_transmitter_id_pk" PRIMARY KEY("beacon_id","transmitter_id")
);
--> statement-breakpoint
CREATE TABLE "onboarding_options" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"question_id" bigint NOT NULL,
	"beacon_id" bigint NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"emoji" text,
	"clearance_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relay_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_questions" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"beacon_id" bigint NOT NULL,
	"title" text NOT NULL,
	"multiple" boolean DEFAULT true NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transmitter_notes" (
	"owner_id" bigint NOT NULL,
	"target_id" bigint NOT NULL,
	"note" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transmitter_notes_owner_id_target_id_pk" PRIMARY KEY("owner_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"beacon_id" bigint NOT NULL,
	"actor_id" bigint,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_name" text,
	"changes" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automod_rules" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"beacon_id" bigint NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regexes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"presets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mention_limit" integer DEFAULT 5 NOT NULL,
	"block_message" boolean DEFAULT true NOT NULL,
	"custom_message" text,
	"alert_channel_id" bigint,
	"timeout_seconds" integer DEFAULT 0 NOT NULL,
	"exempt_clearance_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exempt_relay_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"creator_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beacon_stickers" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"beacon_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"emoji" text NOT NULL,
	"url" text NOT NULL,
	"creator_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beacon_templates" (
	"code" text PRIMARY KEY NOT NULL,
	"beacon_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"snapshot" jsonb NOT NULL,
	"creator_id" bigint,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gif_favorites" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"url" text NOT NULL,
	"preview_url" text NOT NULL,
	"width" integer DEFAULT 0 NOT NULL,
	"height" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "soundboard_sounds" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"beacon_id" bigint NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"url" text NOT NULL,
	"volume_pct" integer DEFAULT 100 NOT NULL,
	"creator_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_apps" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"owner_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon_url" text,
	"client_secret_hash" text NOT NULL,
	"redirect_uris" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"app_id" bigint NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"grant_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"scopes" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_bots" (
	"app_id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"message_content" boolean DEFAULT false NOT NULL,
	"interactions_url" text,
	"public_key" text NOT NULL,
	"private_key_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_bots_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "app_bots_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app_commands" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"app_id" bigint NOT NULL,
	"beacon_id" bigint,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_member_permissions" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"beacon_id" bigint NOT NULL,
	"relay_id" bigint NOT NULL,
	"author_id" bigint NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"token_hash" text NOT NULL,
	"creator_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_connections" ADD CONSTRAINT "account_connections_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_target_id_transmitters_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archival_threads" ADD CONSTRAINT "archival_threads_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archival_threads" ADD CONSTRAINT "archival_threads_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_clusters" ADD CONSTRAINT "beacon_clusters_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_emojis" ADD CONSTRAINT "beacon_emojis_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_emojis" ADD CONSTRAINT "beacon_emojis_uploader_id_transmitters_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_members" ADD CONSTRAINT "beacon_members_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_members" ADD CONSTRAINT "beacon_members_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacons" ADD CONSTRAINT "beacons_owner_id_transmitters_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearances" ADD CONSTRAINT "clearances_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_connections" ADD CONSTRAINT "drive_connections_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2ee_devices" ADD CONSTRAINT "e2ee_devices_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2ee_one_time_pre_keys" ADD CONSTRAINT "e2ee_one_time_pre_keys_device_id_e2ee_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."e2ee_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reporter_id_transmitters_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_resolved_by_staff_id_transmitters_id_fk" FOREIGN KEY ("resolved_by_staff_id") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_to_point_links" ADD CONSTRAINT "point_to_point_links_transmitter1_id_transmitters_id_fk" FOREIGN KEY ("transmitter1_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_to_point_links" ADD CONSTRAINT "point_to_point_links_transmitter2_id_transmitters_id_fk" FOREIGN KEY ("transmitter2_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_transmission_id_transmissions_id_fk" FOREIGN KEY ("transmission_id") REFERENCES "public"."transmissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_overwrites" ADD CONSTRAINT "relay_overwrites_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relays" ADD CONSTRAINT "relays_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_blacklist" ADD CONSTRAINT "signal_blacklist_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subspace_mesh_members" ADD CONSTRAINT "subspace_mesh_members_mesh_id_subspace_meshes_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "public"."subspace_meshes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subspace_mesh_members" ADD CONSTRAINT "subspace_mesh_members_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subspace_meshes" ADD CONSTRAINT "subspace_meshes_owner_id_transmitters_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_thread_id_archival_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."archival_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmission_requests" ADD CONSTRAINT "transmission_requests_sender_id_transmitters_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmission_requests" ADD CONSTRAINT "transmission_requests_recipient_id_transmitters_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmission_requests" ADD CONSTRAINT "transmission_requests_mutual_beacon_id_beacons_id_fk" FOREIGN KEY ("mutual_beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmissions" ADD CONSTRAINT "transmissions_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmissions" ADD CONSTRAINT "transmissions_thread_id_archival_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."archival_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmissions" ADD CONSTRAINT "transmissions_p2p_link_id_point_to_point_links_id_fk" FOREIGN KEY ("p2p_link_id") REFERENCES "public"."point_to_point_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmissions" ADD CONSTRAINT "transmissions_mesh_id_subspace_meshes_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "public"."subspace_meshes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmissions" ADD CONSTRAINT "transmissions_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmitter_commendations" ADD CONSTRAINT "transmitter_commendations_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmitter_commendations" ADD CONSTRAINT "transmitter_commendations_commendation_id_commendations_id_fk" FOREIGN KEY ("commendation_id") REFERENCES "public"."commendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmitter_passkeys" ADD CONSTRAINT "transmitter_passkeys_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmitter_relay_preferences" ADD CONSTRAINT "transmitter_relay_preferences_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmitter_relay_preferences" ADD CONSTRAINT "transmitter_relay_preferences_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmitters" ADD CONSTRAINT "transmitters_storage_group_id_storage_groups_id_fk" FOREIGN KEY ("storage_group_id") REFERENCES "public"."storage_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_files" ADD CONSTRAINT "vault_files_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_to_point_link_hidden" ADD CONSTRAINT "point_to_point_link_hidden_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_states" ADD CONSTRAINT "read_states_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmission_reactions" ADD CONSTRAINT "transmission_reactions_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_bans" ADD CONSTRAINT "beacon_bans_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_bans" ADD CONSTRAINT "beacon_bans_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_bans" ADD CONSTRAINT "beacon_bans_banned_by_transmitters_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_events" ADD CONSTRAINT "beacon_events_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_events" ADD CONSTRAINT "beacon_events_creator_id_transmitters_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_events" ADD CONSTRAINT "beacon_events_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_interests" ADD CONSTRAINT "event_interests_event_id_beacon_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."beacon_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_interests" ADD CONSTRAINT "event_interests_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_inviter_id_transmitters_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_owner_id_transmitters_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_beacon_prefs" ADD CONSTRAINT "member_beacon_prefs_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_beacon_prefs" ADD CONSTRAINT "member_beacon_prefs_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_options" ADD CONSTRAINT "onboarding_options_question_id_onboarding_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."onboarding_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_options" ADD CONSTRAINT "onboarding_options_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_questions" ADD CONSTRAINT "onboarding_questions_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmitter_notes" ADD CONSTRAINT "transmitter_notes_owner_id_transmitters_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmitter_notes" ADD CONSTRAINT "transmitter_notes_target_id_transmitters_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_transmitters_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_rules" ADD CONSTRAINT "automod_rules_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_rules" ADD CONSTRAINT "automod_rules_creator_id_transmitters_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_stickers" ADD CONSTRAINT "beacon_stickers_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_stickers" ADD CONSTRAINT "beacon_stickers_creator_id_transmitters_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_templates" ADD CONSTRAINT "beacon_templates_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_templates" ADD CONSTRAINT "beacon_templates_creator_id_transmitters_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gif_favorites" ADD CONSTRAINT "gif_favorites_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soundboard_sounds" ADD CONSTRAINT "soundboard_sounds_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soundboard_sounds" ADD CONSTRAINT "soundboard_sounds_creator_id_transmitters_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_apps" ADD CONSTRAINT "oauth_apps_owner_id_transmitters_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_app_id_oauth_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."oauth_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_bots" ADD CONSTRAINT "app_bots_app_id_oauth_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."oauth_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_bots" ADD CONSTRAINT "app_bots_user_id_transmitters_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_commands" ADD CONSTRAINT "app_commands_app_id_oauth_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."oauth_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_commands" ADD CONSTRAINT "app_commands_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_author_id_transmitters_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_creator_id_transmitters_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_connections_unique" ON "account_connections" USING btree ("transmitter_id","provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "transmissions_transmitter_idx" ON "transmissions" USING btree ("transmitter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transmitters_username_discriminator_idx" ON "transmitters" USING btree ("username","discriminator");--> statement-breakpoint
CREATE UNIQUE INDEX "transmitters_phone_idx" ON "transmitters" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "audit_log_beacon_created_idx" ON "audit_log" USING btree ("beacon_id","created_at");--> statement-breakpoint
CREATE INDEX "gif_favorites_owner_idx" ON "gif_favorites" USING btree ("transmitter_id","created_at");--> statement-breakpoint
CREATE INDEX "oauth_apps_owner" ON "oauth_apps" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grants_unique" ON "oauth_grants" USING btree ("app_id","transmitter_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_grant" ON "oauth_tokens" USING btree ("grant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_commands_unique" ON "app_commands" USING btree ("app_id","beacon_id","name");--> statement-breakpoint
CREATE INDEX "webhooks_relay" ON "webhooks" USING btree ("relay_id");