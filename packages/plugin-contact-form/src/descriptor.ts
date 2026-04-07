import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { contactFormCliModule } from "./cli/module";
import { contactFormPluginDefinition } from "./backend/module";
import { contactFormSharedProjectUi } from "./shared/projectUi";

export const contactFormPluginDescriptor = {
  pluginId: contactFormPluginDefinition.pluginId,
  definition: contactFormPluginDefinition,
  sharedProjectUi: contactFormSharedProjectUi,
  cli: contactFormCliModule,
} satisfies PluginPackageDescriptor<"contact_form">;
