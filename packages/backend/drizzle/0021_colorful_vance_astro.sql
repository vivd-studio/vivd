CREATE TABLE "contact_form_recipient_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"plugin_instance_id" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verification_token_hash" text,
	"verification_token_expires_at" timestamp,
	"last_sent_at" timestamp,
	"verified_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_form_recipient_verification" ADD CONSTRAINT "contact_form_recipient_verification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_form_recipient_verification" ADD CONSTRAINT "contact_form_recipient_verification_plugin_instance_id_project_plugin_instance_id_fk" FOREIGN KEY ("plugin_instance_id") REFERENCES "public"."project_plugin_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_form_recipient_verification" ADD CONSTRAINT "contact_form_recipient_verification_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_form_recipient_verification" ADD CONSTRAINT "contact_form_recipient_verification_organization_id_project_slug_project_meta_organization_id_slug_fk" FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_form_recipient_verification_org_project_email_unique" ON "contact_form_recipient_verification" USING btree ("organization_id","project_slug","email");--> statement-breakpoint
CREATE INDEX "contact_form_recipient_verification_plugin_status_idx" ON "contact_form_recipient_verification" USING btree ("plugin_instance_id","status");--> statement-breakpoint
CREATE INDEX "contact_form_recipient_verification_token_hash_idx" ON "contact_form_recipient_verification" USING btree ("verification_token_hash");