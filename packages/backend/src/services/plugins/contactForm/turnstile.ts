import {
  createContactFormTurnstileService,
  startContactFormTurnstileSyncJob as startPluginContactFormTurnstileSyncJob,
} from "@vivd/plugin-contact-form/backend/turnstile";
import { db } from "../../../db";
import {
  pluginEntitlement,
  projectMeta,
  projectPluginInstance,
} from "../../../db/schema";
import { inferContactFormAutoSourceHosts } from "./sourceHosts";

export * from "@vivd/plugin-contact-form/backend/turnstile";

export const contactFormTurnstileService = createContactFormTurnstileService({
  db,
  tables: {
    pluginEntitlement,
    projectMeta,
    projectPluginInstance,
  },
  inferSourceHosts: inferContactFormAutoSourceHosts,
});

export function startContactFormTurnstileSyncJob(): () => void {
  return startPluginContactFormTurnstileSyncJob(contactFormTurnstileService);
}
