CREATE TABLE IF NOT EXISTS "analytics_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"plugin_instance_id" text NOT NULL,
	"event_type" text NOT NULL,
	"path" text NOT NULL,
	"referrer_host" text,
	"source_host" text,
	"visitor_id_hash" text,
	"session_id" text,
	"device_type" text,
	"country_code" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_event_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
		ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "analytics_event_plugin_instance_id_project_plugin_instance_id_fk"
		FOREIGN KEY ("plugin_instance_id") REFERENCES "public"."project_plugin_instance"("id")
		ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "analytics_event_org_project_project_meta_fk"
		FOREIGN KEY ("organization_id", "project_slug")
		REFERENCES "public"."project_meta"("organization_id", "slug")
		ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_event_org_project_created_idx"
	ON "analytics_event" USING btree ("organization_id","project_slug","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_event_plugin_created_idx"
	ON "analytics_event" USING btree ("plugin_instance_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_event_plugin_type_created_idx"
	ON "analytics_event" USING btree ("plugin_instance_id","event_type","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_event_plugin_path_created_idx"
	ON "analytics_event" USING btree ("plugin_instance_id","path","created_at");
--> statement-breakpoint
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
		CHECK ("plugin_id" IN ('contact_form', 'analytics'));
END $$;
