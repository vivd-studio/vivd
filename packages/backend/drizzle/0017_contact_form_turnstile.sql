ALTER TABLE "plugin_entitlement"
	ADD COLUMN IF NOT EXISTS "turnstile_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "plugin_entitlement"
	ADD COLUMN IF NOT EXISTS "turnstile_widget_id" text;
--> statement-breakpoint
ALTER TABLE "plugin_entitlement"
	ADD COLUMN IF NOT EXISTS "turnstile_site_key" text;
--> statement-breakpoint
ALTER TABLE "plugin_entitlement"
	ADD COLUMN IF NOT EXISTS "turnstile_secret_key" text;
