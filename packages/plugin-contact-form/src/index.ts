export {
  DEFAULT_CONTACT_FORM_FIELDS,
  contactFormFieldSchema,
  contactFormFieldTypeSchema,
  contactFormPluginConfigSchema,
  createContactFormPluginModule,
  contactFormPluginDefinition,
} from "./backend/module";
export {
  createContactFormPluginBackendHooks,
} from "./backend/adminHooks";
export { createContactFormPluginBackendHooks as createContactFormBackendHooks } from "./backendHooks";
export { contactFormPluginDescriptor } from "./descriptor";
export {
  createContactFormPluginBackendContribution,
} from "./backend/contribution";
export type {
  ContactFormPluginBackendContributionDeps,
} from "./backend/ports";
export { contactFormCliModule } from "./cli/module";
export { contactFormFrontendPluginModule } from "./frontend/module";
export { default as ContactFormProjectPage } from "./frontend/ContactFormProjectPage";
export { contactFormSharedProjectUi } from "./shared/projectUi";
