CREATE TABLE "app_activities" (
	"app_id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"max_participants" integer DEFAULT 16 NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_activities" ADD CONSTRAINT "app_activities_app_id_oauth_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."oauth_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_activities" ADD CONSTRAINT "app_activities_approved_by_transmitters_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;