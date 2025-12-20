CREATE TABLE "published_site" (
	"id" text PRIMARY KEY NOT NULL,
	"project_slug" text NOT NULL,
	"project_version" integer NOT NULL,
	"domain" text NOT NULL,
	"commit_hash" text NOT NULL,
	"published_at" timestamp NOT NULL,
	"published_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "published_site_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
ALTER TABLE "published_site" ADD CONSTRAINT "published_site_published_by_id_user_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "published_site_domain_idx" ON "published_site" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "published_site_project_idx" ON "published_site" USING btree ("project_slug","project_version");