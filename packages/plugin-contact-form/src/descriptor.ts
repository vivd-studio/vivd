import type { PluginPackageInstallDescriptor } from "@vivd/plugin-sdk";
import { definePluginPackageInstallDescriptor } from "@vivd/plugin-sdk";
import { contactFormPluginManifest } from "./manifest";

export const contactFormPluginDescriptor =
  definePluginPackageInstallDescriptor({
    pluginId: contactFormPluginManifest.pluginId,
    manifest: contactFormPluginManifest,
    surfaceExports: {
      backend: "@vivd/plugin-contact-form/backend/plugin",
      frontend: "@vivd/plugin-contact-form/frontend/plugin",
      cli: "@vivd/plugin-contact-form/cli/plugin",
    },
  } as const satisfies PluginPackageInstallDescriptor<"contact_form">);
