import type { PluginBundleEntry } from "@vivd/plugin-sdk";
import { definePluginBundleEntry } from "@vivd/plugin-sdk";
import { contactFormPluginManifest } from "./manifest";

export const contactFormPluginDescriptor =
  definePluginBundleEntry({
    pluginId: contactFormPluginManifest.pluginId,
    manifest: contactFormPluginManifest,
    surfaceExports: {
      backend: "@vivd/plugin-contact-form/backend/plugin",
      frontend: "@vivd/plugin-contact-form/frontend/plugin",
      cli: "@vivd/plugin-contact-form/cli/plugin",
    },
  } as const satisfies PluginBundleEntry<"contact_form">);
