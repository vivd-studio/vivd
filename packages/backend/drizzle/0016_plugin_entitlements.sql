CREATE TABLE IF NOT EXISTS "plugin_entitlement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"scope" text DEFAULT 'project' NOT NULL,
	"project_slug" text DEFAULT '' NOT NULL,
	"plugin_id" text NOT NULL,
	"state" text DEFAULT 'disabled' NOT NULL,
	"managed_by" text DEFAULT 'manual_superadmin' NOT NULL,
	"monthly_event_limit" integer,
	"hard_stop" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"changed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_entitlement_scope_check" CHECK ("scope" IN ('organization', 'project')),
	CONSTRAINT "plugin_entitlement_state_check" CHECK ("state" IN ('disabled', 'enabled', 'suspended')),
	CONSTRAINT "plugin_entitlement_managed_by_check" CHECK ("managed_by" IN ('manual_superadmin', 'plan', 'self_serve')),
	CONSTRAINT "plugin_entitlement_scope_project_slug_check" CHECK (
		("scope" = 'organization' AND "project_slug" = '')
		OR ("scope" = 'project' AND "project_slug" <> '')
	),
	CONSTRAINT "plugin_entitlement_plugin_id_check" CHECK ("plugin_id" IN ('contact_form'))
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'plugin_entitlement_organization_id_organization_id_fk'
	) THEN
		ALTER TABLE "plugin_entitlement"
			ADD CONSTRAINT "plugin_entitlement_organization_id_organization_id_fk"
			FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'plugin_entitlement_changed_by_user_id_user_id_fk'
	) THEN
		ALTER TABLE "plugin_entitlement"
			ADD CONSTRAINT "plugin_entitlement_changed_by_user_id_user_id_fk"
			FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_entitlement_org_scope_project_plugin_unique" ON "plugin_entitlement" USING btree ("organization_id","scope","project_slug","plugin_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_entitlement_org_plugin_idx" ON "plugin_entitlement" USING btree ("organization_id","plugin_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_entitlement_plugin_state_idx" ON "plugin_entitlement" USING btree ("plugin_id","state");
