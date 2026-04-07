import { describe, expect, it } from "vitest";
import { getStudioProjectPluginShortcuts } from "./shortcuts";

describe("getStudioProjectPluginShortcuts", () => {
  it("keeps analytics visible in the studio toolbar before activation", () => {
    const shortcuts = getStudioProjectPluginShortcuts({
      enabledPluginIds: [],
      projectSlug: "bettinis-bikinis",
      surface: "studio-toolbar",
    });

    expect(shortcuts).toHaveLength(1);
    expect(shortcuts[0]).toMatchObject({
      pluginId: "analytics",
      enabled: false,
      label: "Analytics",
      path: "/vivd-studio/projects/bettinis-bikinis/analytics",
      activationSupport: {
        title: "Analytics needs activation",
        description: "Analytics is not active for this project yet.",
      },
    });
  });
});
