import { describe, expect, it } from "vitest";
import { getProjectPluginShortcuts } from "./shortcuts";

describe("getProjectPluginShortcuts", () => {
  it("returns the analytics shortcut for enabled project surfaces", () => {
    const shortcuts = getProjectPluginShortcuts({
      enabledPluginIds: ["analytics"],
      projectSlug: "bettinis-bikinis",
      surface: "project-card",
    });

    expect(shortcuts).toHaveLength(1);
    expect(shortcuts[0]).toMatchObject({
      pluginId: "analytics",
      enabled: true,
      label: "Analytics",
      path: "/vivd-studio/projects/bettinis-bikinis/plugins/analytics",
    });
  });

  it("filters external embed plugins out of host shortcuts", () => {
    const shortcuts = getProjectPluginShortcuts({
      enabledPluginIds: ["google_maps", "analytics"],
      projectSlug: "bettinis-bikinis",
      surface: "project-card",
    });

    expect(shortcuts.map((shortcut) => shortcut.pluginId)).toEqual(["analytics"]);
  });

  it("does not expose direct project shortcuts for disabled plugins on host surfaces", () => {
    const shortcuts = getProjectPluginShortcuts({
      enabledPluginIds: [],
      projectSlug: "bettinis-bikinis",
      surface: "project-header",
    });

    expect(shortcuts).toEqual([]);
  });
});
