ALTER TABLE "organization" ADD COLUMN "github_repo_prefix" text NOT NULL DEFAULT '';
--> statement-breakpoint

UPDATE "organization"
SET "github_repo_prefix" = "slug"
WHERE "github_repo_prefix" = '';
--> statement-breakpoint
