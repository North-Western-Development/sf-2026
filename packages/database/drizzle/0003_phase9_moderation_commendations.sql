ALTER TABLE "transmitters" ADD COLUMN IF NOT EXISTS "is_banned" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "transmitters" ADD COLUMN IF NOT EXISTS "ban_reason" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_reports" (
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
DO $$ BEGIN
 ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reporter_id_transmitters_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_resolved_by_staff_id_transmitters_id_fk" FOREIGN KEY ("resolved_by_staff_id") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
