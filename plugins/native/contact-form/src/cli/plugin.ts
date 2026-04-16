import { contactFormCliModule } from "./module";
import { contactFormPluginManifest } from "../manifest";

export const contactFormCliPluginPackage = {
  ...contactFormPluginManifest,
  cli: contactFormCliModule,
} as const;

export default contactFormCliPluginPackage;
