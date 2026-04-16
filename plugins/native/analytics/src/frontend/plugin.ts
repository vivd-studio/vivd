import { analyticsPluginManifest } from "../manifest";
import { analyticsFrontendPluginModule } from "./module";

export const analyticsFrontendPluginPackage = {
  ...analyticsPluginManifest,
  frontend: analyticsFrontendPluginModule,
} as const;

export default analyticsFrontendPluginPackage;
