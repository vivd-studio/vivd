import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsCliPluginPackage } from "./cli/plugin";

export const analyticsPluginDescriptor: PluginPackageDescriptor<"analytics"> =
  analyticsCliPluginPackage;
