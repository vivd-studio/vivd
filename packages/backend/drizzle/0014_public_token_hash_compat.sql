DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = 'project_plugin_instance'
		  AND column_name = 'public_token_hash'
		  AND is_nullable = 'NO'
	) THEN
		ALTER TABLE "project_plugin_instance"
			ALTER COLUMN "public_token_hash" DROP NOT NULL;
	END IF;
END $$;
--> statement-breakpoint
UPDATE "project_plugin_instance"
SET "public_token" = coalesce(
	"public_token",
	coalesce("id", md5(random()::text || clock_timestamp()::text)) || '.legacy'
)
WHERE "public_token" IS NULL;
--> statement-breakpoint
ALTER TABLE "project_plugin_instance"
	ALTER COLUMN "public_token" SET NOT NULL;
