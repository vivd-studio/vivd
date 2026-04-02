import { router } from "../../trpc";
import { catalogPluginProcedure } from "./catalog";
import {
  analyticsEnsurePluginProcedure,
  analyticsInfoPluginProcedure,
  analyticsSummaryPluginProcedure,
  analyticsUpdateConfigPluginProcedure,
} from "./analytics";
import {
  contactEnsurePluginProcedure,
  contactInfoPluginProcedure,
  contactRequestRecipientVerificationPluginProcedure,
  contactUpdateConfigPluginProcedure,
} from "./contactForm";

export const pluginsRouter = router({
  catalog: catalogPluginProcedure,
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
