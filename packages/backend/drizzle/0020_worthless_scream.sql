CREATE TABLE "studio_machine_visit" (
	"organization_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"version" integer NOT NULL,
	"last_visited_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "studio_machine_visit_organization_id_project_slug_version_pk" PRIMARY KEY("organization_id","project_slug","version")
);
--> statement-breakpoint
ALTER TABLE "studio_machine_visit" ADD CONSTRAINT "studio_machine_visit_organization_id_project_slug_version_project_version_organization_id_project_slug_version_fk" FOREIGN KEY ("organization_id","project_slug","version") REFERENCES "public"."project_version"("organization_id","project_slug","version") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "studio_machine_visit_last_visited_idx" ON "studio_machine_visit" USING btree ("last_visited_at");
--> statement-breakpoint
CREATE INDEX "studio_machine_visit_org_last_visited_idx" ON "studio_machine_visit" USING btree ("organization_id","last_visited_at");
