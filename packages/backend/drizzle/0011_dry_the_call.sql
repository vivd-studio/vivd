CREATE TABLE "domain" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"usage" text NOT NULL,
	"status" text NOT NULL,
	"verification_method" text,
	"verification_token" text,
	"verified_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain"
ADD CONSTRAINT "domain_organization_id_organization_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organization"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "domain"
ADD CONSTRAINT "domain_created_by_id_user_id_fk"
FOREIGN KEY ("created_by_id")
REFERENCES "public"."user"("id")
ON DELETE set null
ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "domain_domain_unique" ON "domain" USING btree ("domain");
--> statement-breakpoint
CREATE INDEX "domain_org_usage_status_idx" ON "domain" USING btree ("organization_id","usage","status");
--> statement-breakpoint
CREATE INDEX "domain_org_type_idx" ON "domain" USING btree ("organization_id","type");
--> statement-breakpoint

-- Backfill existing published domains so existing customer traffic remains valid.
INSERT INTO "domain" (
	"id",
	"domain",
	"organization_id",
	"type",
	"usage",
	"status",
	"verification_method",
	"verification_token",
	"verified_at",
	"created_by_id"
)
SELECT
	'publish:' || md5(p."organization_id" || ':' || p."normalized_domain") AS "id",
	p."normalized_domain" AS "domain",
	p."organization_id" AS "organization_id",
	'custom_domain' AS "type",
	'publish_target' AS "usage",
	'active' AS "status",
	NULL AS "verification_method",
	NULL AS "verification_token",
	now() AS "verified_at",
	NULL AS "created_by_id"
FROM (
	SELECT DISTINCT
		"organization_id",
		lower(regexp_replace("domain", '^www\.', '')) AS "normalized_domain"
	FROM "published_site"
) p
ON CONFLICT ("domain") DO NOTHING;
--> statement-breakpoint

-- Backfill managed tenant hosts for all orgs except "default".
-- Default base domain is vivd.studio; can be overridden per session via:
--   SET vivd.tenant_base_domain = 'your-domain.example';
DO $$
DECLARE
	tenant_base text := COALESCE(NULLIF(current_setting('vivd.tenant_base_domain', true), ''), 'vivd.studio');
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "organization" o
		JOIN "domain" d ON d."domain" = lower(o."slug" || '.' || tenant_base)
		WHERE o."id" <> 'default'
			AND d."organization_id" <> o."id"
	) THEN
		RAISE EXCEPTION 'Managed tenant host collision detected while backfilling domain table';
	END IF;

	INSERT INTO "domain" (
		"id",
		"domain",
		"organization_id",
		"type",
		"usage",
		"status",
		"verification_method",
		"verification_token",
		"verified_at",
		"created_by_id"
	)
	SELECT
		'managed:' || o."id" AS "id",
		lower(o."slug" || '.' || tenant_base) AS "domain",
		o."id" AS "organization_id",
		'managed_subdomain' AS "type",
		'tenant_host' AS "usage",
		'active' AS "status",
		NULL AS "verification_method",
		NULL AS "verification_token",
		now() AS "verified_at",
		NULL AS "created_by_id"
	FROM "organization" o
	WHERE o."id" <> 'default'
	ON CONFLICT ("domain") DO NOTHING;
END $$;
