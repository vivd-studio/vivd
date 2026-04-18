ALTER TABLE "organization_invitation" ADD COLUMN "invitee_name" text;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN "project_slug" text;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN "accepted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN "last_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN "accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN "canceled_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD CONSTRAINT "organization_invitation_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_invitation_token_hash_idx" ON "organization_invitation" USING btree ("token_hash");