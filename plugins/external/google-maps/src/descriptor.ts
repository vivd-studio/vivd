import type { PluginBundleEntry } from "@vivd/plugin-sdk";
import { definePluginBundleEntry } from "@vivd/plugin-sdk";
import { googleMapsPluginManifest } from "./manifest";

export const googleMapsPluginDescriptor = definePluginBundleEntry({
  pluginId: googleMapsPluginManifest.pluginId,
  manifest: googleMapsPluginManifest,
} as const satisfies PluginBundleEntry<"google_maps">);

export default googleMapsPluginDescriptor;
