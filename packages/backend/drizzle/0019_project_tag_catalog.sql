CREATE TABLE "project_tag" (
	"organization_id" text NOT NULL,
	"tag" text NOT NULL,
	"color_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_tag_organization_id_tag_pk" PRIMARY KEY("organization_id","tag")
);
--> statement-breakpoint
ALTER TABLE "project_tag" ADD CONSTRAINT "project_tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_tag_org_idx" ON "project_tag" USING btree ("organization_id");
