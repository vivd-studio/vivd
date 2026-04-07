import type { ProjectPluginUiRegistry } from "@vivd/shared/types";
import { analyticsSharedProjectUi } from "@vivd/plugin-analytics/shared/projectUi";
import { contactFormSharedProjectUi } from "@vivd/plugin-contact-form/shared/projectUi";

export const frontendSharedProjectPluginUiRegistry = {
  contact_form: contactFormSharedProjectUi,
  analytics: analyticsSharedProjectUi,
} satisfies ProjectPluginUiRegistry;
