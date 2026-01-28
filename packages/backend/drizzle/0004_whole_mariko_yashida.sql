CREATE TABLE "usage_period" (
	"id" text PRIMARY KEY NOT NULL,
	"period_type" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"total_cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"image_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_record" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"cost" numeric(10, 6) NOT NULL,
	"tokens" jsonb,
	"session_id" text,
	"project_slug" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "usage_period_type_idx" ON "usage_period" USING btree ("period_type");--> statement-breakpoint
CREATE INDEX "usage_period_start_idx" ON "usage_period" USING btree ("period_start");--> statement-breakpoint
CREATE INDEX "usage_record_created_at_idx" ON "usage_record" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_record_event_type_idx" ON "usage_record" USING btree ("event_type");
