DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'plugin_entitlement_plugin_id_check'
	) THEN
		ALTER TABLE "plugin_entitlement"
			DROP CONSTRAINT "plugin_entitlement_plugin_id_check";
	END IF;

	ALTER TABLE "plugin_entitlement"
		ADD CONSTRAINT "plugin_entitlement_plugin_id_check"
		CHECK ("plugin_id" IN ('contact_form', 'analytics', 'newsletter', 'table_booking', 'google_maps'));
END $$;
