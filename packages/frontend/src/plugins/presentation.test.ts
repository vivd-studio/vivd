import { describe, expect, it } from "vitest";
import {
  isNativeProjectPluginId,
  listEnabledNativeProjectPluginPresentations,
} from "./presentation";

describe("isNativeProjectPluginId", () => {
  it("recognizes native plugins and excludes external embeds", () => {
    expect(isNativeProjectPluginId("analytics")).toBe(true);
    expect(isNativeProjectPluginId("google_maps")).toBe(false);
  });
});

describe("listEnabledNativeProjectPluginPresentations", () => {
  it("keeps only native enabled plugins in the original order", () => {
    const plugins = listEnabledNativeProjectPluginPresentations({
      enabledPluginIds: ["google_maps", "analytics", "newsletter", "analytics"],
      projectSlug: "bettinis-bikinis",
    });

    expect(plugins).toHaveLength(2);
    expect(plugins).toMatchObject([
      {
        pluginId: "analytics",
        title: "Analytics",
        path: "/vivd-studio/projects/bettinis-bikinis/plugins/analytics",
      },
      {
        pluginId: "newsletter",
        title: "Newsletter",
        path: "/vivd-studio/projects/bettinis-bikinis/plugins/newsletter",
      },
    ]);
  });
});
