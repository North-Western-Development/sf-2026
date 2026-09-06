CREATE TABLE IF NOT EXISTS "archival_threads" (
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
CREATE TABLE IF NOT EXISTS "transmitter_relay_preferences" (
	"transmitter_id" uuid NOT NULL,
	"relay_id" uuid NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transmitter_relay_preferences_transmitter_id_relay_id_pk" PRIMARY KEY("transmitter_id","relay_id")
);
--> statement-breakpoint
ALTER TABLE "transmissions" ADD COLUMN IF NOT EXISTS "thread_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "archival_threads" ADD CONSTRAINT "archival_threads_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "archival_threads" ADD CONSTRAINT "archival_threads_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transmitter_relay_preferences" ADD CONSTRAINT "transmitter_relay_preferences_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transmitter_relay_preferences" ADD CONSTRAINT "transmitter_relay_preferences_relay_id_relays_id_fk" FOREIGN KEY ("relay_id") REFERENCES "public"."relays"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transmissions" ADD CONSTRAINT "transmissions_thread_id_archival_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."archival_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transmissions_content_tsv" ON "transmissions" USING gin (to_tsvector('english', "content"));
