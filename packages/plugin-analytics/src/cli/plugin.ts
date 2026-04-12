import { analyticsCliModule } from "./module";
import { analyticsPluginManifest } from "../manifest";

export const analyticsCliPluginPackage = {
  ...analyticsPluginManifest,
  cli: analyticsCliModule,
} as const;
