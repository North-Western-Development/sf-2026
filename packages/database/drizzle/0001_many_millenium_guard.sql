CREATE TABLE "affiliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transmitter_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"greeting_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_to_point_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transmitter1_id" uuid NOT NULL,
	"transmitter2_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_blacklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transmitter_id" uuid NOT NULL,
	"target_id" text NOT NULL,
	"target_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subspace_mesh_members" (
	"mesh_id" uuid NOT NULL,
	"transmitter_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subspace_mesh_members_mesh_id_transmitter_id_pk" PRIMARY KEY("mesh_id","transmitter_id")
);
--> statement-breakpoint
CREATE TABLE "subspace_meshes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transmission_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"mutual_beacon_id" uuid NOT NULL,
	"initial_transmission" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transmissions" ALTER COLUMN "relay_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transmissions" ADD COLUMN "p2p_link_id" uuid;--> statement-breakpoint
ALTER TABLE "transmissions" ADD COLUMN "mesh_id" uuid;--> statement-breakpoint
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_target_id_transmitters_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_to_point_links" ADD CONSTRAINT "point_to_point_links_transmitter1_id_transmitters_id_fk" FOREIGN KEY ("transmitter1_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_to_point_links" ADD CONSTRAINT "point_to_point_links_transmitter2_id_transmitters_id_fk" FOREIGN KEY ("transmitter2_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_blacklist" ADD CONSTRAINT "signal_blacklist_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subspace_mesh_members" ADD CONSTRAINT "subspace_mesh_members_mesh_id_subspace_meshes_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "public"."subspace_meshes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subspace_mesh_members" ADD CONSTRAINT "subspace_mesh_members_transmitter_id_transmitters_id_fk" FOREIGN KEY ("transmitter_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subspace_meshes" ADD CONSTRAINT "subspace_meshes_owner_id_transmitters_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmission_requests" ADD CONSTRAINT "transmission_requests_sender_id_transmitters_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmission_requests" ADD CONSTRAINT "transmission_requests_recipient_id_transmitters_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."transmitters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmission_requests" ADD CONSTRAINT "transmission_requests_mutual_beacon_id_beacons_id_fk" FOREIGN KEY ("mutual_beacon_id") REFERENCES "public"."beacons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmissions" ADD CONSTRAINT "transmissions_p2p_link_id_point_to_point_links_id_fk" FOREIGN KEY ("p2p_link_id") REFERENCES "public"."point_to_point_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmissions" ADD CONSTRAINT "transmissions_mesh_id_subspace_meshes_id_fk" FOREIGN KEY ("mesh_id") REFERENCES "public"."subspace_meshes"("id") ON DELETE cascade ON UPDATE no action;