CREATE TABLE "table_booking_reservation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"plugin_instance_id" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"service_date" text NOT NULL,
	"service_start_at" timestamp NOT NULL,
	"service_end_at" timestamp NOT NULL,
	"party_size" integer NOT NULL,
	"guest_name" text NOT NULL,
	"guest_email" text NOT NULL,
	"guest_email_normalized" text NOT NULL,
	"guest_phone" text NOT NULL,
	"notes" text,
	"source_host" text,
	"source_path" text,
	"referrer_host" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"last_ip_hash" text,
	"confirmed_at" timestamp,
	"cancelled_at" timestamp,
	"cancelled_by" text,
	"completed_at" timestamp,
	"no_show_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_booking_action_token" (
	"id" text PRIMARY KEY NOT NULL,
	"reservation_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "table_booking_reservation" ADD CONSTRAINT "table_booking_reservation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_booking_reservation" ADD CONSTRAINT "table_booking_reservation_plugin_instance_id_project_plugin_instance_id_fk" FOREIGN KEY ("plugin_instance_id") REFERENCES "public"."project_plugin_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_booking_reservation" ADD CONSTRAINT "table_booking_reservation_organization_id_project_slug_project_meta_organization_id_slug_fk" FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_booking_action_token" ADD CONSTRAINT "table_booking_action_token_reservation_id_table_booking_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."table_booking_reservation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_booking_action_token" ADD CONSTRAINT "table_booking_action_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_booking_action_token" ADD CONSTRAINT "table_booking_action_token_organization_id_project_slug_project_meta_organization_id_slug_fk" FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "table_booking_reservation_org_project_status_service_idx" ON "table_booking_reservation" USING btree ("organization_id","project_slug","status","service_start_at");--> statement-breakpoint
CREATE INDEX "table_booking_reservation_plugin_service_date_idx" ON "table_booking_reservation" USING btree ("plugin_instance_id","service_date","service_start_at");--> statement-breakpoint
CREATE INDEX "table_booking_reservation_plugin_email_created_idx" ON "table_booking_reservation" USING btree ("plugin_instance_id","guest_email_normalized","created_at");--> statement-breakpoint
CREATE INDEX "table_booking_action_token_hash_idx" ON "table_booking_action_token" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "table_booking_action_token_reservation_kind_unique" ON "table_booking_action_token" USING btree ("reservation_id","kind");--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'plugin_entitlement_plugin_id_check'
	) THEN
		ALTER TABLE "plugin_entitlement"
			DROP CONSTRAINT "plugin_entitlement_plugin_id_check";
	END IF;

	ALTER TABLE "plugin_entitlement"
		ADD CONSTRAINT "plugin_entitlement_plugin_id_check"
		CHECK ("plugin_id" IN ('contact_form', 'analytics', 'newsletter', 'table_booking'));
END $$;
