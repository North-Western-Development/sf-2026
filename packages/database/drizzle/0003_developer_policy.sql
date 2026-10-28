CREATE TABLE "instance_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transmitters" ADD COLUMN "hand_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_apps" ADD COLUMN "detected_game" text;--> statement-breakpoint
ALTER TABLE "app_bots" ADD COLUMN "activity_intent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_apps_detected_game" ON "oauth_apps" USING btree ("detected_game");