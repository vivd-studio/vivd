import { newsletterPluginManifest } from "../manifest";
import { newsletterFrontendPluginModule } from "./module";

export const newsletterFrontendPluginPackage = {
  ...newsletterPluginManifest,
  frontend: newsletterFrontendPluginModule,
} as const;

export default newsletterFrontendPluginPackage;
