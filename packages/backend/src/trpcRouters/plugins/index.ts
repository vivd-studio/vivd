import { router } from "../../trpc";
import { catalogPluginProcedure } from "./catalog";
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
});
