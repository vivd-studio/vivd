ALTER TABLE "organization_invitation" ADD COLUMN IF NOT EXISTS "invitee_name" text;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN IF NOT EXISTS "project_slug" text;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN IF NOT EXISTS "token_hash" text;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN IF NOT EXISTS "accepted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN IF NOT EXISTS "last_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN IF NOT EXISTS "accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN IF NOT EXISTS "canceled_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_invitation" ADD CONSTRAINT "organization_invitation_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_invitation_token_hash_idx" ON "organization_invitation" USING btree ("token_hash");
