ALTER TABLE "usage_record" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_idempotency_key_unique" UNIQUE("idempotency_key");