CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "organization_status_idx" ON "organization" USING btree ("status");
--> statement-breakpoint

-- Default tenant / internal org
INSERT INTO "organization" ("id", "slug", "name", "status", "limits")
VALUES ('default', 'default', 'Default', 'active', '{}'::jsonb)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

-- Better Auth session org selection (single-org UX default)
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;
--> statement-breakpoint
UPDATE "session"
SET "active_organization_id" = 'default'
WHERE "active_organization_id" IS NULL;
--> statement-breakpoint
CREATE INDEX "session_active_org_idx" ON "session" USING btree ("active_organization_id");
--> statement-breakpoint

CREATE TABLE "organization_member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_member_org_user_unique" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "organization_member" ADD CONSTRAINT "organization_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_member" ADD CONSTRAINT "organization_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "organization_member_org_idx" ON "organization_member" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "organization_member_user_idx" ON "organization_member" USING btree ("user_id");
--> statement-breakpoint

CREATE TABLE "organization_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"inviter_id" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD CONSTRAINT "organization_invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD CONSTRAINT "organization_invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "organization_invitation_org_idx" ON "organization_invitation" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "organization_invitation_email_idx" ON "organization_invitation" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "organization_invitation_status_idx" ON "organization_invitation" USING btree ("status");
--> statement-breakpoint

-- Backfill default org membership for all existing users
INSERT INTO "organization_member" ("id", "organization_id", "user_id", "role")
SELECT
	('default:' || "id") as "id",
	'default' as "organization_id",
	"id" as "user_id",
	CASE
		WHEN "role" = 'client_editor' THEN 'client_editor'
		WHEN "role" = 'admin' THEN 'owner'
		ELSE 'member'
	END as "role"
FROM "user"
ON CONFLICT ("organization_id","user_id") DO NOTHING;
--> statement-breakpoint

-- Promote existing admin(s) to super-admin
UPDATE "user"
SET "role" = 'super_admin'
WHERE "role" = 'admin';
--> statement-breakpoint

-- Tenant scoping columns (backfill all existing rows to default)
ALTER TABLE "project_meta" ADD COLUMN "organization_id" text;
--> statement-breakpoint
UPDATE "project_meta" SET "organization_id" = 'default' WHERE "organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "project_meta" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_meta" ADD CONSTRAINT "project_meta_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_version" ADD COLUMN "organization_id" text;
--> statement-breakpoint
UPDATE "project_version" SET "organization_id" = 'default' WHERE "organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "project_version" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_version" ADD CONSTRAINT "project_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_publish_checklist" ADD COLUMN "organization_id" text;
--> statement-breakpoint
UPDATE "project_publish_checklist" SET "organization_id" = 'default' WHERE "organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "project_publish_checklist" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_publish_checklist" ADD CONSTRAINT "project_publish_checklist_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "project_member" ADD COLUMN "organization_id" text;
--> statement-breakpoint
UPDATE "project_member" SET "organization_id" = 'default' WHERE "organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "project_member" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "published_site" ADD COLUMN "organization_id" text;
--> statement-breakpoint
UPDATE "published_site" SET "organization_id" = 'default' WHERE "organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "published_site" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "published_site" ADD CONSTRAINT "published_site_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "usage_record" ADD COLUMN "organization_id" text;
--> statement-breakpoint
UPDATE "usage_record" SET "organization_id" = 'default' WHERE "organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "usage_record" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "usage_period" ADD COLUMN "organization_id" text;
--> statement-breakpoint
UPDATE "usage_period" SET "organization_id" = 'default' WHERE "organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "usage_period" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_period" ADD CONSTRAINT "usage_period_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Update table constraints / indexes for composite org scoping
ALTER TABLE "project_version" DROP CONSTRAINT "project_version_project_slug_project_meta_slug_fk";
--> statement-breakpoint
ALTER TABLE "project_publish_checklist" DROP CONSTRAINT "project_publish_checklist_project_slug_project_meta_slug_fk";
--> statement-breakpoint

ALTER TABLE "project_meta" DROP CONSTRAINT "project_meta_pkey";
--> statement-breakpoint
ALTER TABLE "project_meta" ADD CONSTRAINT "project_meta_pkey" PRIMARY KEY ("organization_id","slug");
--> statement-breakpoint

DROP INDEX "project_meta_slug_idx";
--> statement-breakpoint
CREATE INDEX "project_meta_org_slug_idx" ON "project_meta" USING btree ("organization_id","slug");
--> statement-breakpoint
CREATE INDEX "project_meta_org_updated_idx" ON "project_meta" USING btree ("organization_id","updated_at");
--> statement-breakpoint

DROP INDEX "project_version_project_idx";
--> statement-breakpoint
DROP INDEX "project_version_slug_version_unique";
--> statement-breakpoint
CREATE INDEX "project_version_org_project_idx" ON "project_version" USING btree ("organization_id","project_slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_version_org_slug_version_unique" ON "project_version" USING btree ("organization_id","project_slug","version");
--> statement-breakpoint

DROP INDEX "project_publish_checklist_project_idx";
--> statement-breakpoint
DROP INDEX "project_publish_checklist_slug_version_unique";
--> statement-breakpoint
CREATE INDEX "project_publish_checklist_org_project_idx" ON "project_publish_checklist" USING btree ("organization_id","project_slug","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_publish_checklist_org_slug_version_unique" ON "project_publish_checklist" USING btree ("organization_id","project_slug","version");
--> statement-breakpoint

ALTER TABLE "project_version" ADD CONSTRAINT "project_version_organization_id_project_slug_project_meta_org_slug_fk" FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_publish_checklist" ADD CONSTRAINT "project_publish_checklist_organization_id_project_slug_project_meta_org_slug_fk" FOREIGN KEY ("organization_id","project_slug") REFERENCES "public"."project_meta"("organization_id","slug") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_publish_checklist" ADD CONSTRAINT "project_publish_checklist_org_slug_version_project_version_org_slug_version_fk" FOREIGN KEY ("organization_id","project_slug","version") REFERENCES "public"."project_version"("organization_id","project_slug","version") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- project_member: new unique + composite index (keeps existing user index)
DROP INDEX "project_member_project_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "project_member_org_user_unique" ON "project_member" USING btree ("organization_id","user_id");
--> statement-breakpoint
CREATE INDEX "project_member_project_idx" ON "project_member" USING btree ("organization_id","project_slug");
--> statement-breakpoint

-- published_site: add org-aware indexes
DROP INDEX "published_site_project_idx";
--> statement-breakpoint
CREATE INDEX "published_site_project_idx" ON "published_site" USING btree ("organization_id","project_slug","project_version");
--> statement-breakpoint
CREATE INDEX "published_site_org_idx" ON "published_site" USING btree ("organization_id");
--> statement-breakpoint

-- usage: org-aware indexes + composite PK for period aggregates
CREATE INDEX "usage_record_org_idx" ON "usage_record" USING btree ("organization_id");
--> statement-breakpoint

ALTER TABLE "usage_period" DROP CONSTRAINT "usage_period_pkey";
--> statement-breakpoint
ALTER TABLE "usage_period" ADD CONSTRAINT "usage_period_pkey" PRIMARY KEY ("organization_id","id");
--> statement-breakpoint
CREATE INDEX "usage_period_org_idx" ON "usage_period" USING btree ("organization_id");
