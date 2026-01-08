CREATE TABLE IF NOT EXISTS "project_member" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_member_user_idx" ON "project_member" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_member_project_idx" ON "project_member" USING btree ("project_slug");