CREATE TABLE "staff_audit_log" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"actor_id" bigint,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"summary" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#3B8EF2' NOT NULL,
	"position" integer NOT NULL,
	"permissions" integer DEFAULT 0 NOT NULL,
	"is_root" boolean DEFAULT false NOT NULL,
	"legacy_rank" integer,
	"badge_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_roles_legacy_rank_unique" UNIQUE("legacy_rank")
);
--> statement-breakpoint
ALTER TABLE "commendations" ADD COLUMN "is_custom" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commendations" ADD COLUMN "created_by" bigint;--> statement-breakpoint
ALTER TABLE "transmitters" ADD COLUMN "staff_role_id" bigint;--> statement-breakpoint
ALTER TABLE "staff_audit_log" ADD CONSTRAINT "staff_audit_log_actor_id_transmitters_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_badge_id_commendations_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."commendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_audit_log_created_idx" ON "staff_audit_log" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "commendations" ADD CONSTRAINT "commendations_created_by_transmitters_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."transmitters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmitters" ADD CONSTRAINT "transmitters_staff_role_id_staff_roles_id_fk" FOREIGN KEY ("staff_role_id") REFERENCES "public"."staff_roles"("id") ON DELETE set null ON UPDATE no action;