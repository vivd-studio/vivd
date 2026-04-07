import {
  buildContactFormOrganizationProjectSummaries,
  cleanupContactFormEntitlementFields,
  prepareContactFormEntitlementFields,
} from "./backend/adminHooks";

export const contactFormPluginBackendHooks = {
  buildOrganizationProjectSummaries:
    buildContactFormOrganizationProjectSummaries,
  prepareProjectEntitlementFields: prepareContactFormEntitlementFields,
  cleanupProjectEntitlementFields: cleanupContactFormEntitlementFields,
};
