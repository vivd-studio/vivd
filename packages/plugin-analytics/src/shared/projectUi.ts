import type { SharedProjectPluginUiDefinition } from "@vivd/shared/types";

export const analyticsSharedProjectUi = {
  pageTitle: "Analytics",
  openLabel: "Open dashboard",
  shortcut: {
    label: "Analytics",
    icon: "bar-chart-3",
    keywords: ["analytics", "traffic", "metrics"],
    expandedWidth: 100,
    surfaces: [
      { surface: "navigation-search" },
      { surface: "project-card" },
      { surface: "project-header" },
      { surface: "studio-mobile-menu", showWhenDisabled: true },
      { surface: "studio-toolbar", showWhenDisabled: true },
    ],
    activationSupport: {
      title: "Analytics needs activation",
      description: "Analytics is not active for this project yet.",
      supportSubject: "Activate Analytics",
      supportActionLabel: "Email Vivd support",
    },
  },
} satisfies SharedProjectPluginUiDefinition;
