import { router } from "../../trpc";
import { catalogPluginProcedure } from "./catalog";
import {
  analyticsEnsurePluginProcedure,
  analyticsInfoPluginProcedure,
  analyticsSummaryPluginProcedure,
  analyticsUpdateConfigPluginProcedure,
} from "@vivd/plugin-analytics/backend/router";
import {
  ensurePluginProcedure,
  infoPluginProcedure,
  runPluginActionProcedure,
  updatePluginConfigProcedure,
} from "./generic";
import {
  contactEnsurePluginProcedure,
  contactInfoPluginProcedure,
  contactRequestRecipientVerificationPluginProcedure,
  contactUpdateConfigPluginProcedure,
} from "./contactForm";

export const pluginsRouter = router({
  catalog: catalogPluginProcedure,
  ensure: ensurePluginProcedure,
  info: infoPluginProcedure,
  updateConfig: updatePluginConfigProcedure,
  action: runPluginActionProcedure,
  contactEnsure: contactEnsurePluginProcedure,
  contactInfo: contactInfoPluginProcedure,
  contactUpdateConfig: contactUpdateConfigPluginProcedure,
  contactRequestRecipientVerification:
    contactRequestRecipientVerificationPluginProcedure,
  analyticsEnsure: analyticsEnsurePluginProcedure,
  analyticsInfo: analyticsInfoPluginProcedure,
  analyticsUpdateConfig: analyticsUpdateConfigPluginProcedure,
  analyticsSummary: analyticsSummaryPluginProcedure,
});
