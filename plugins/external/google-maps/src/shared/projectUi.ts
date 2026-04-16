import type { SharedProjectPluginUiDefinition } from "@vivd/plugin-sdk";

export const googleMapsSharedProjectUi = {
  pageTitle: "Google Maps",
  openLabel: "Open embed settings",
  shortcut: {
    label: "Google Maps",
    icon: "plug",
    route: {
      kind: "plugin-page",
    },
    keywords: ["maps", "location", "embed"],
    surfaces: [
      {
        surface: "navigation-search",
      },
      {
        surface: "project-card",
      },
    ],
  },
} satisfies SharedProjectPluginUiDefinition;
