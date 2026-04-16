CREATE TABLE "newsletter_campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"plugin_instance_id" text NOT NULL,
	"mode" text DEFAULT 'newsletter' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"audience" text DEFAULT 'all_confirmed' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"estimated_recipient_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletter_campaign" ADD CONSTRAINT "newsletter_campaign_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaign" ADD CONSTRAINT "newsletter_campaign_plugin_instance_id_project_plugin_instance_id_fk" FOREIGN KEY ("plugin_instance_id") REFERENCES "public"."project_plugin_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaign" ADD CONSTRAINT "newsletter_campaign_organization_id_project_slug_project_meta_organization_id_slug_fk" FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_campaign_org_project_status_updated_idx" ON "newsletter_campaign" USING btree ("organization_id","project_slug","status","updated_at");--> statement-breakpoint
CREATE INDEX "newsletter_campaign_plugin_updated_idx" ON "newsletter_campaign" USING btree ("plugin_instance_id","updated_at");