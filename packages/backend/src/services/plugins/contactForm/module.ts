import type {
  PluginModule,
} from "@vivd/shared/types";
import {
  contactFormPluginConfigSchema,
  contactFormPluginDefinition,
  type ContactFormPluginConfig,
} from "@vivd/plugin-contact-form/backend/module";
import { contactFormPluginModule as backendContactFormPluginModule } from "./backendContribution";

export { contactFormPluginConfigSchema, contactFormPluginDefinition };
export type { ContactFormPluginConfig };

export const contactFormPluginModule: PluginModule<"contact_form"> =
  backendContactFormPluginModule;
