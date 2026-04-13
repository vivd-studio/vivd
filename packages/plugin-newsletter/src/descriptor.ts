import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { newsletterCliPluginPackage } from "./cli/plugin";

export const newsletterPluginDescriptor: PluginPackageDescriptor<"newsletter"> =
  newsletterCliPluginPackage;
