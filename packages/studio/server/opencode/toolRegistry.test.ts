import { describe, expect, it } from "vitest";
import {
  getStudioOpencodeToolDefinitions,
  resolveStudioOpencodeToolPolicy,
} from "./toolRegistry.js";

describe("OpenCode tool registry", () => {
  it("loads managed tool definitions from source files", () => {
    const tools = getStudioOpencodeToolDefinitions();
    expect(tools.length).toBeGreaterThanOrEqual(3);
    expect(tools.some((tool) => tool.name === "vivd_plugins_catalog")).toBe(true);
    expect(tools.some((tool) => tool.name === "vivd_publish_checklist")).toBe(true);
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

  it("applies feature flags and role constraints", () => {
    const policy = resolveStudioOpencodeToolPolicy({
      VIVD_OPENCODE_TOOL_FLAGS: JSON.stringify({
        plugins: false,
        contact_forms: false,
      }),
      VIVD_ORGANIZATION_ROLE: "client_editor",
    });

    expect(policy.enabledByName.vivd_plugins_catalog).toBe(false);
    expect(policy.enabledByName.vivd_plugins_contact_info).toBe(false);
  });
});
