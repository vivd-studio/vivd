CREATE TABLE IF NOT EXISTS "project_plugin_access_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"plugin_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" text,
	"requester_email" text DEFAULT '' NOT NULL,
	"email_provider" text,
	"email_message_id" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_plugin_access_request" ADD CONSTRAINT "project_plugin_access_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_plugin_access_request" ADD CONSTRAINT "project_plugin_access_request_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_plugin_access_request" ADD CONSTRAINT "project_plugin_access_request_organization_id_project_slug_project_meta_organization_id_slug_fk" FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_plugin_access_request_org_project_plugin_unique" ON "project_plugin_access_request" USING btree ("organization_id","project_slug","plugin_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_plugin_access_request_org_project_idx" ON "project_plugin_access_request" USING btree ("organization_id","project_slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_plugin_access_request_status_idx" ON "project_plugin_access_request" USING btree ("status");
