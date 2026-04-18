CREATE TABLE IF NOT EXISTS "newsletter_campaign_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"subscriber_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"plugin_instance_id" text NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"recipient_name" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"skip_reason" text,
	"failure_reason" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletter_campaign" ADD COLUMN IF NOT EXISTS "recipient_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "newsletter_campaign" ADD COLUMN IF NOT EXISTS "test_sent_at" timestamp;
--> statement-breakpoint
ALTER TABLE "newsletter_campaign" ADD COLUMN IF NOT EXISTS "queued_at" timestamp;
--> statement-breakpoint
ALTER TABLE "newsletter_campaign" ADD COLUMN IF NOT EXISTS "started_at" timestamp;
--> statement-breakpoint
ALTER TABLE "newsletter_campaign" ADD COLUMN IF NOT EXISTS "completed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "newsletter_campaign" ADD COLUMN IF NOT EXISTS "canceled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "newsletter_campaign" ADD COLUMN IF NOT EXISTS "last_error" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "newsletter_campaign_delivery" ADD CONSTRAINT "newsletter_campaign_delivery_campaign_id_newsletter_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."newsletter_campaign"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "newsletter_campaign_delivery" ADD CONSTRAINT "newsletter_campaign_delivery_subscriber_id_newsletter_subscriber_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."newsletter_subscriber"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "newsletter_campaign_delivery" ADD CONSTRAINT "newsletter_campaign_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "newsletter_campaign_delivery" ADD CONSTRAINT "newsletter_campaign_delivery_plugin_instance_id_project_plugin_instance_id_fk" FOREIGN KEY ("plugin_instance_id") REFERENCES "public"."project_plugin_instance"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "newsletter_campaign_delivery" ADD CONSTRAINT "newsletter_campaign_delivery_organization_id_project_slug_project_meta_organization_id_slug_fk" FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_campaign_delivery_campaign_subscriber_unique" ON "newsletter_campaign_delivery" USING btree ("campaign_id","subscriber_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_campaign_delivery_campaign_status_idx" ON "newsletter_campaign_delivery" USING btree ("campaign_id","status","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_campaign_delivery_plugin_status_created_idx" ON "newsletter_campaign_delivery" USING btree ("plugin_instance_id","status","created_at");
