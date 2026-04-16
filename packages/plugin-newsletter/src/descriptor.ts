import type { PluginPackageDescriptor } from "@vivd/plugin-sdk";
import { newsletterCliPluginPackage } from "./cli/plugin";

export const newsletterPluginDescriptor: PluginPackageDescriptor<"newsletter"> =
  newsletterCliPluginPackage;
