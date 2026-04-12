import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { contactFormCliPluginPackage } from "./cli/plugin";

export const contactFormPluginDescriptor: PluginPackageDescriptor<"contact_form"> =
  contactFormCliPluginPackage;
