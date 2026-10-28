CREATE TABLE "bookmarks" (
	"transmitter_id" bigint NOT NULL,
	"transmission_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_transmitter_id_transmission_id_pk" PRIMARY KEY("transmitter_id","transmission_id")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" bigint PRIMARY KEY DEFAULT subspace_snowflake() NOT NULL,
	"transmitter_id" bigint NOT NULL,
	"transmission_id" bigint NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_transmitter" ON "reminders" USING btree ("transmitter_id");--> statement-breakpoint
CREATE INDEX "reminders_due" ON "reminders" USING btree ("remind_at");