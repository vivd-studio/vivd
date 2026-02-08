CREATE TABLE "project_meta" (
	"slug" text PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'scratch' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_publish_checklist" (
	"id" text PRIMARY KEY NOT NULL,
	"project_slug" text NOT NULL,
	"version" integer NOT NULL,
	"run_at" timestamp NOT NULL,
	"snapshot_commit_hash" text,
	"checklist" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_version" (
	"id" text PRIMARY KEY NOT NULL,
	"project_slug" text NOT NULL,
	"version" integer NOT NULL,
	"source" text DEFAULT 'scratch' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"started_at" timestamp,
	"error_message" text,
	"thumbnail_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_publish_checklist" ADD CONSTRAINT "project_publish_checklist_project_slug_project_meta_slug_fk" FOREIGN KEY ("project_slug") REFERENCES "public"."project_meta"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_version" ADD CONSTRAINT "project_version_project_slug_project_meta_slug_fk" FOREIGN KEY ("project_slug") REFERENCES "public"."project_meta"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_meta_slug_idx" ON "project_meta" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "project_publish_checklist_project_idx" ON "project_publish_checklist" USING btree ("project_slug","version");--> statement-breakpoint
CREATE UNIQUE INDEX "project_publish_checklist_slug_version_unique" ON "project_publish_checklist" USING btree ("project_slug","version");--> statement-breakpoint
CREATE INDEX "project_version_project_idx" ON "project_version" USING btree ("project_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "project_version_slug_version_unique" ON "project_version" USING btree ("project_slug","version");