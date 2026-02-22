import { describe, expect, it } from "vitest";
import {
  getStudioOpencodeToolDefinitions,
  resolveStudioOpencodeToolPolicy,
} from "./toolRegistry.js";

describe("OpenCode tool registry", () => {
  it("loads managed tool definitions from source files", () => {
    const tools = getStudioOpencodeToolDefinitions();
    expect(tools.length).toBeGreaterThanOrEqual(5);
    expect(tools.some((tool) => tool.name === "vivd_plugins_catalog")).toBe(true);
    expect(tools.some((tool) => tool.name === "vivd_plugins_analytics_info")).toBe(
      true,
    );
    expect(tools.some((tool) => tool.name === "vivd_publish_checklist")).toBe(true);
    expect(tools.some((tool) => tool.name === "vivd_image_ai")).toBe(true);
    expect(
      tools.every(
        (tool) =>
          tool.moduleDistRelativePath.startsWith("opencode/toolModules/") &&
          tool.moduleSourceRelativePath.startsWith("server/opencode/toolModules/") &&
          tool.definitionExportName.length > 0,
      ),
    ).toBe(true);
  });

  it("respects explicit disable list", () => {
    const policy = resolveStudioOpencodeToolPolicy({
      VIVD_OPENCODE_TOOLS_DISABLE: "vivd_plugins_contact_info",
    });

    expect(policy.enabledByName.vivd_plugins_contact_info).toBe(false);
    expect(policy.enabledByName.vivd_plugins_catalog).toBe(true);
  });

  it("keeps checklist tool disabled by default unless explicitly enabled", () => {
    const defaultPolicy = resolveStudioOpencodeToolPolicy({});
    expect(defaultPolicy.enabledByName.vivd_publish_checklist).toBe(false);

    const forcedPolicy = resolveStudioOpencodeToolPolicy({
      VIVD_OPENCODE_TOOLS_ENABLE: "vivd_publish_checklist",
    });
    expect(forcedPolicy.enabledByName.vivd_publish_checklist).toBe(true);
  });

  it("keeps image tool enabled by default and supports image_ai feature flag disable", () => {
    const defaultPolicy = resolveStudioOpencodeToolPolicy({});
    expect(defaultPolicy.enabledByName.vivd_image_ai).toBe(true);

    const disabledPolicy = resolveStudioOpencodeToolPolicy({
      VIVD_OPENCODE_TOOL_FLAGS: JSON.stringify({ image_ai: false }),
    });
    expect(disabledPolicy.enabledByName.vivd_image_ai).toBe(false);
  });

  it("applies feature flags and role constraints", () => {
    const policy = resolveStudioOpencodeToolPolicy({
      VIVD_OPENCODE_TOOL_FLAGS: JSON.stringify({
        plugins: false,
        contact_forms: false,
        analytics: false,
      }),
      VIVD_ORGANIZATION_ROLE: "client_editor",
    });

    expect(policy.enabledByName.vivd_plugins_catalog).toBe(false);
    expect(policy.enabledByName.vivd_plugins_contact_info).toBe(false);
    expect(policy.enabledByName.vivd_plugins_analytics_info).toBe(false);
  });

  it("enables plugin-specific tools only when required plugins are active", () => {
    const noPluginPolicy = resolveStudioOpencodeToolPolicy({});
    expect(noPluginPolicy.enabledByName.vivd_plugins_contact_info).toBe(false);
    expect(noPluginPolicy.enabledByName.vivd_plugins_analytics_info).toBe(false);

    const contactOnlyPolicy = resolveStudioOpencodeToolPolicy({
      VIVD_ENABLED_PLUGINS: "contact_form",
    });
    expect(contactOnlyPolicy.enabledByName.vivd_plugins_contact_info).toBe(true);
    expect(contactOnlyPolicy.enabledByName.vivd_plugins_analytics_info).toBe(false);

    const allPluginsPolicy = resolveStudioOpencodeToolPolicy({
      VIVD_ENABLED_PLUGINS: "contact_form,analytics",
    });
    expect(allPluginsPolicy.enabledByName.vivd_plugins_contact_info).toBe(true);
    expect(allPluginsPolicy.enabledByName.vivd_plugins_analytics_info).toBe(true);
  });
});
