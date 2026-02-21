CREATE TABLE IF NOT EXISTS "contact_form_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"plugin_instance_id" text NOT NULL,
	"source_host" text,
	"ip_hash" text,
	"user_agent" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_plugin_instance" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"plugin_id" text NOT NULL,
	"status" text DEFAULT 'enabled' NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"public_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Heal partially created tables from earlier manual/failed attempts.
ALTER TABLE "contact_form_submission" ADD COLUMN IF NOT EXISTS "id" text;--> statement-breakpoint
ALTER TABLE "contact_form_submission" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
ALTER TABLE "contact_form_submission" ADD COLUMN IF NOT EXISTS "project_slug" text;--> statement-breakpoint
ALTER TABLE "contact_form_submission" ADD COLUMN IF NOT EXISTS "plugin_instance_id" text;--> statement-breakpoint
ALTER TABLE "contact_form_submission" ADD COLUMN IF NOT EXISTS "source_host" text;--> statement-breakpoint
ALTER TABLE "contact_form_submission" ADD COLUMN IF NOT EXISTS "ip_hash" text;--> statement-breakpoint
ALTER TABLE "contact_form_submission" ADD COLUMN IF NOT EXISTS "user_agent" text;--> statement-breakpoint
ALTER TABLE "contact_form_submission" ADD COLUMN IF NOT EXISTS "payload" jsonb;--> statement-breakpoint
ALTER TABLE "contact_form_submission" ADD COLUMN IF NOT EXISTS "created_at" timestamp;--> statement-breakpoint
UPDATE "contact_form_submission" SET "payload" = '{}'::jsonb WHERE "payload" IS NULL;--> statement-breakpoint
UPDATE "contact_form_submission" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "contact_form_submission" ALTER COLUMN "payload" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "contact_form_submission" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint

ALTER TABLE "project_plugin_instance" ADD COLUMN IF NOT EXISTS "id" text;--> statement-breakpoint
ALTER TABLE "project_plugin_instance" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
ALTER TABLE "project_plugin_instance" ADD COLUMN IF NOT EXISTS "project_slug" text;--> statement-breakpoint
ALTER TABLE "project_plugin_instance" ADD COLUMN IF NOT EXISTS "plugin_id" text;--> statement-breakpoint
ALTER TABLE "project_plugin_instance" ADD COLUMN IF NOT EXISTS "status" text;--> statement-breakpoint
ALTER TABLE "project_plugin_instance" ADD COLUMN IF NOT EXISTS "config_json" jsonb;--> statement-breakpoint
ALTER TABLE "project_plugin_instance" ADD COLUMN IF NOT EXISTS "public_token" text;--> statement-breakpoint
ALTER TABLE "project_plugin_instance" ADD COLUMN IF NOT EXISTS "created_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_plugin_instance" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;--> statement-breakpoint
UPDATE "project_plugin_instance" SET "status" = 'enabled' WHERE "status" IS NULL;--> statement-breakpoint
UPDATE "project_plugin_instance" SET "config_json" = '{}'::jsonb WHERE "config_json" IS NULL;--> statement-breakpoint
UPDATE "project_plugin_instance" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
UPDATE "project_plugin_instance" SET "updated_at" = now() WHERE "updated_at" IS NULL;--> statement-breakpoint
UPDATE "project_plugin_instance"
SET "public_token" = coalesce("id", md5(random()::text || clock_timestamp()::text)) || '.legacy'
WHERE "public_token" IS NULL;--> statement-breakpoint
ALTER TABLE "project_plugin_instance" ALTER COLUMN "status" SET DEFAULT 'enabled';--> statement-breakpoint
ALTER TABLE "project_plugin_instance" ALTER COLUMN "config_json" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "project_plugin_instance" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "project_plugin_instance" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'contact_form_submission_organization_id_organization_id_fk'
	) THEN
		ALTER TABLE "contact_form_submission"
			ADD CONSTRAINT "contact_form_submission_organization_id_organization_id_fk"
			FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'contact_form_submission_plugin_instance_id_project_plugin_instance_id_fk'
	) THEN
		ALTER TABLE "contact_form_submission"
			ADD CONSTRAINT "contact_form_submission_plugin_instance_id_project_plugin_instance_id_fk"
			FOREIGN KEY ("plugin_instance_id") REFERENCES "public"."project_plugin_instance"("id") ON DELETE cascade ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'contact_form_submission_organization_id_project_slug_project_meta_organization_id_slug_fk'
	) THEN
		ALTER TABLE "contact_form_submission"
			ADD CONSTRAINT "contact_form_submission_organization_id_project_slug_project_meta_organization_id_slug_fk"
			FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'project_plugin_instance_organization_id_organization_id_fk'
	) THEN
		ALTER TABLE "project_plugin_instance"
			ADD CONSTRAINT "project_plugin_instance_organization_id_organization_id_fk"
			FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'project_plugin_instance_organization_id_project_slug_project_meta_organization_id_slug_fk'
	) THEN
		ALTER TABLE "project_plugin_instance"
			ADD CONSTRAINT "project_plugin_instance_organization_id_project_slug_project_meta_organization_id_slug_fk"
			FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_form_submission_org_project_created_idx" ON "contact_form_submission" USING btree ("organization_id","project_slug","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_form_submission_plugin_created_idx" ON "contact_form_submission" USING btree ("plugin_instance_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_plugin_instance_org_project_plugin_unique" ON "project_plugin_instance" USING btree ("organization_id","project_slug","plugin_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_plugin_instance_public_token_unique" ON "project_plugin_instance" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_plugin_instance_org_project_idx" ON "project_plugin_instance" USING btree ("organization_id","project_slug");
