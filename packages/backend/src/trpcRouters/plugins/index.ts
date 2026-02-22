import { router } from "../../trpc";
import { catalogPluginProcedure } from "./catalog";
import {
  analyticsInfoPluginProcedure,
  analyticsSummaryPluginProcedure,
  analyticsUpdateConfigPluginProcedure,
} from "./analytics";
import {
  contactEnsurePluginProcedure,
  contactInfoPluginProcedure,
  contactUpdateConfigPluginProcedure,
} from "./contactForm";

export const pluginsRouter = router({
  catalog: catalogPluginProcedure,
  contactEnsure: contactEnsurePluginProcedure,
  contactInfo: contactInfoPluginProcedure,
  contactUpdateConfig: contactUpdateConfigPluginProcedure,
  analyticsInfo: analyticsInfoPluginProcedure,
  analyticsUpdateConfig: analyticsUpdateConfigPluginProcedure,
  analyticsSummary: analyticsSummaryPluginProcedure,
});
