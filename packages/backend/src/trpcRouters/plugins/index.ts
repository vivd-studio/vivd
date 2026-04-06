import { router } from "../../trpc";
import { catalogPluginProcedure } from "./catalog";
import { ensurePluginProcedure } from "./generic";
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
  ensure: ensurePluginProcedure,
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
