CREATE TABLE "dev_team_members" (
	"team_id" bigint NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"role" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"invited_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dev_team_members_team_id_transmitter_id_pk" PRIMARY KEY("team_id","transmitter_id")
);
--> statement-breakpoint
CREATE TABLE "dev_teams" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"name" text NOT NULL,
	"owner_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "is_announcement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transmissions" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transmissions" ADD COLUMN "crosspost" jsonb;--> statement-breakpoint
ALTER TABLE "oauth_apps" ADD COLUMN "team_id" bigint;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "source_relay_id" bigint;--> statement-breakpoint
ALTER TABLE "dev_team_members" ADD CONSTRAINT "dev_team_members_team_id_dev_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."dev_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_team_members" ADD CONSTRAINT "dev_team_members_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_team_members" ADD CONSTRAINT "dev_team_members_invited_by_transmitters_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_teams" ADD CONSTRAINT "dev_teams_owner_id_transmitters_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dev_team_members_user" ON "dev_team_members" USING btree ("transmitter_id");--> statement-breakpoint
ALTER TABLE "oauth_apps" ADD CONSTRAINT "oauth_apps_team_id_dev_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."dev_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_source_relay_id_relays_id_fk" FOREIGN KEY ("source_relay_id") REFERENCES "public"."relays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhooks_source_relay" ON "webhooks" USING btree ("source_relay_id");