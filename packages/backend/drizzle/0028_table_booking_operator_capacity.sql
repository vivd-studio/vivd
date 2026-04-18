CREATE TABLE IF NOT EXISTS "table_booking_capacity_adjustment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"plugin_instance_id" text NOT NULL,
	"service_date" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"mode" text NOT NULL,
	"capacity_value" integer,
	"reason" text,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "table_booking_reservation" ADD COLUMN IF NOT EXISTS "source_channel" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "table_booking_reservation" ADD COLUMN IF NOT EXISTS "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "table_booking_reservation" ADD COLUMN IF NOT EXISTS "updated_by_user_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "table_booking_capacity_adjustment" ADD CONSTRAINT "table_booking_capacity_adjustment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "table_booking_capacity_adjustment" ADD CONSTRAINT "table_booking_capacity_adjustment_plugin_instance_id_project_plugin_instance_id_fk" FOREIGN KEY ("plugin_instance_id") REFERENCES "public"."project_plugin_instance"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "table_booking_capacity_adjustment" ADD CONSTRAINT "table_booking_capacity_adjustment_organization_id_project_slug_project_meta_organization_id_slug_fk" FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "table_booking_capacity_adjustment_plugin_date_idx" ON "table_booking_capacity_adjustment" USING btree ("plugin_instance_id","service_date","start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "table_booking_capacity_adjustment_org_project_date_idx" ON "table_booking_capacity_adjustment" USING btree ("organization_id","project_slug","service_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "table_booking_reservation_plugin_source_service_idx" ON "table_booking_reservation" USING btree ("plugin_instance_id","source_channel","service_start_at");
