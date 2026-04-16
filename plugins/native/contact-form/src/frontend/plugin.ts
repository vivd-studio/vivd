import { contactFormPluginManifest } from "../manifest";
import { contactFormFrontendPluginModule } from "./module";

export const contactFormFrontendPluginPackage = {
  ...contactFormPluginManifest,
  frontend: contactFormFrontendPluginModule,
} as const;

export default contactFormFrontendPluginPackage;
