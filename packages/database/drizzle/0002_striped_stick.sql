CREATE TABLE "archival_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"relay_id" uuid NOT NULL,
	"transmitter_id" uuid NOT NULL,
	"title" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"root_transmission_id" uuid,
	"transmission_count" integer DEFAULT 0 NOT NULL,
	"last_transmission_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beacon_emojis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beacon_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"uploader_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"description" text,
	"telemetry_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_notes" text,
	"resolved_by_staff_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transmitter_relay_preferences" (
	"transmitter_id" uuid NOT NULL,
	"relay_id" uuid NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transmitter_relay_preferences_transmitter_id_relay_id_pk" PRIMARY KEY("transmitter_id","relay_id")
);
--> statement-breakpoint
ALTER TABLE "transmitters" DROP CONSTRAINT "transmitters_username_unique";--> statement-breakpoint
ALTER TABLE "clearances" ADD COLUMN "hoist" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transmissions" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "transmitters" ADD COLUMN "discriminator" text DEFAULT '0001' NOT NULL;--> statement-breakpoint
ALTER TABLE "transmitters" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "transmitters" ADD COLUMN "is_banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transmitters" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "archival_threads" ADD CONSTRAINT "archival_threads_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archival_threads" ADD CONSTRAINT "archival_threads_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_emojis" ADD CONSTRAINT "beacon_emojis_beacon_id_beacons_id_fk" FOREIGN KEY ("beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon_emojis" ADD CONSTRAINT "beacon_emojis_uploader_id_transmitters_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reporter_id_transmitters_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_resolved_by_staff_id_transmitters_id_fk" FOREIGN KEY ("resolved_by_staff_id") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmitter_relay_preferences" ADD CONSTRAINT "transmitter_relay_preferences_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmitter_relay_preferences" ADD CONSTRAINT "transmitter_relay_preferences_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmissions" ADD CONSTRAINT "transmissions_thread_id_archival_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."archival_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transmitters_username_discriminator_idx" ON "transmitters" USING btree ("username","discriminator");