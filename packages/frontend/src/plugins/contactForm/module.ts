import type { FrontendPluginModule } from "../types";
import ContactFormProjectPage from "./ContactFormProjectPage";

export const contactFormFrontendPluginModule: FrontendPluginModule = {
  pluginId: "contact_form",
  projectUi: {
    ProjectPage: ContactFormProjectPage,
  },
};
