import type { PluginPackageDescriptor } from "@vivd/plugin-sdk";
import { analyticsCliPluginPackage } from "./cli/plugin";

export const analyticsPluginDescriptor: PluginPackageDescriptor<"analytics"> =
  analyticsCliPluginPackage;
