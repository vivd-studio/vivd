import type {
  ExternalEmbedPluginPackageManifest,
  PluginDefinition,
} from "@vivd/plugin-sdk";
import { definePluginPackageManifest } from "@vivd/plugin-sdk";
import {
  googleMapsPluginConfigSchema,
  googleMapsPluginDefaultConfig,
} from "./config";
import { googleMapsSharedProjectUi } from "./shared/projectUi";

export const googleMapsPluginDefinition = {
  pluginId: "google_maps",
  kind: "external_embed",
  name: "Google Maps",
  description: "Embed a Google Map on a page with a provider-supplied iframe URL.",
  category: "utility",
  version: 1,
  sortOrder: 40,
  configSchema: googleMapsPluginConfigSchema,
  defaultConfig: googleMapsPluginDefaultConfig,
  capabilities: {
    supportsInfo: true,
    config: {
      format: "json",
      supportsShow: true,
      supportsApply: true,
      supportsTemplate: false,
    },
    actions: [],
    reads: [],
  },
} as const satisfies PluginDefinition<"google_maps">;

export const googleMapsPluginManifest = definePluginPackageManifest({
  manifestVersion: 2,
  pluginId: googleMapsPluginDefinition.pluginId,
  kind: googleMapsPluginDefinition.kind,
  definition: googleMapsPluginDefinition,
  sharedProjectUi: googleMapsSharedProjectUi,
  controlPlane: {
    projectPanel: "generic",
    usageLabel: "Embeds",
    limitPrompt: "This embed provider does not expose plugin-level usage limits.",
    supportsMonthlyLimit: false,
    supportsHardStop: false,
    supportsTurnstile: false,
    dashboardPath: null,
  },
  setup: {
    summary:
      "Enable the plugin, paste a Google Maps embed URL, and install the generated iframe snippet.",
    automatedSetup: "partial",
    instructions: [
      "In Google Maps, choose Share or embed map and copy the embed URL from the iframe snippet.",
      "Paste that URL into the plugin config JSON under `embedUrl` and save.",
      "Install the generated iframe snippet where the map should appear in the published site.",
    ],
    docsUrl: "https://support.google.com/maps/answer/144361",
  },
  previewSupport: {
    mode: "limited",
    notes: "Preview is limited to config validation and rendered snippet output.",
  },
  publishChecks: [
    {
      checkId: "google_maps_embed_url",
      title: "Provide a valid Google Maps embed URL",
      severity: "error",
      description:
        "The generated snippet stays empty until the config contains a provider embed URL.",
    },
  ],
  externalEmbed: {
    provider: {
      provider: "Google Maps",
      websiteUrl: "https://www.google.com/maps",
      docsUrl: "https://support.google.com/maps/answer/144361",
    },
    renderMode: "iframe",
    placement: {
      targets: ["page_body"],
      preferredTarget: "page_body",
    },
    inputSchema: googleMapsPluginConfigSchema,
    validationRules: [
      "Use the iframe/embed URL from Google Maps, not a general maps.google.com page URL.",
      "Prefer placing the map near the contact or location section instead of above the primary call to action.",
    ],
    snippetTemplates: {
      html: `<iframe src="{{config.embedUrl}}" title="{{config.title}}" width="100%" height="{{config.height}}" style="border:0;" loading="{{config.loading}}" allowfullscreen referrerpolicy="{{config.referrerPolicy}}"></iframe>`,
      astro: `<iframe src="{{config.embedUrl}}" title="{{config.title}}" width="100%" height="{{config.height}}" style="border:0;" loading="{{config.loading}}" allowfullscreen referrerpolicy="{{config.referrerPolicy}}"></iframe>`,
    },
    security: {
      consentCategory: "functional",
      requiresSecrets: false,
      requiresBackend: false,
      allowedHosts: ["www.google.com", "maps.google.com"],
      cspNotes: [
        "Allow Google Maps iframe hosts in the published site's frame-src policy if CSP is locked down.",
      ],
    },
  },
} as const satisfies ExternalEmbedPluginPackageManifest<"google_maps">);
