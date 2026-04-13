CREATE TABLE "newsletter_action_token" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriber_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscriber" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"plugin_instance_id" text NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"mode" text DEFAULT 'newsletter' NOT NULL,
	"source_host" text,
	"source_path" text,
	"referrer_host" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"last_ip_hash" text,
	"last_confirmation_sent_at" timestamp,
	"last_signup_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"unsubscribed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletter_action_token" ADD CONSTRAINT "newsletter_action_token_subscriber_id_newsletter_subscriber_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."newsletter_subscriber"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_action_token" ADD CONSTRAINT "newsletter_action_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_action_token" ADD CONSTRAINT "newsletter_action_token_organization_id_project_slug_project_meta_organization_id_slug_fk" FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscriber" ADD CONSTRAINT "newsletter_subscriber_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscriber" ADD CONSTRAINT "newsletter_subscriber_plugin_instance_id_project_plugin_instance_id_fk" FOREIGN KEY ("plugin_instance_id") REFERENCES "public"."project_plugin_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscriber" ADD CONSTRAINT "newsletter_subscriber_organization_id_project_slug_project_meta_organization_id_slug_fk" FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_action_token_hash_idx" ON "newsletter_action_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "newsletter_action_token_subscriber_kind_idx" ON "newsletter_action_token" USING btree ("subscriber_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_subscriber_plugin_email_unique" ON "newsletter_subscriber" USING btree ("plugin_instance_id","email_normalized");--> statement-breakpoint
CREATE INDEX "newsletter_subscriber_org_project_status_created_idx" ON "newsletter_subscriber" USING btree ("organization_id","project_slug","status","created_at");--> statement-breakpoint
CREATE INDEX "newsletter_subscriber_plugin_signup_idx" ON "newsletter_subscriber" USING btree ("plugin_instance_id","last_signup_at");--> statement-breakpoint
CREATE INDEX "newsletter_subscriber_plugin_updated_idx" ON "newsletter_subscriber" USING btree ("plugin_instance_id","updated_at");
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
		CHECK ("plugin_id" IN ('contact_form', 'analytics', 'newsletter'));
END $$;
