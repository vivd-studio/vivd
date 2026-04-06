import { describe, expect, it } from "vitest";
import {
  getStudioOpencodeToolDefinitions,
  resolveStudioOpencodeToolPolicy,
} from "./toolRegistry.js";

describe("OpenCode tool registry", () => {
  it("loads the managed image tool definition from source files", () => {
    const tools = getStudioOpencodeToolDefinitions();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("vivd_image_ai");
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
      VIVD_OPENCODE_TOOLS_DISABLE: "vivd_image_ai",
    });

    expect(policy.enabledByName.vivd_image_ai).toBe(false);
  });

  it("keeps the image tool enabled by default", () => {
    const defaultPolicy = resolveStudioOpencodeToolPolicy({});
    expect(defaultPolicy.enabledByName.vivd_image_ai).toBe(true);
  });

  it("supports explicit enable lists", () => {
    const enabledPolicy = resolveStudioOpencodeToolPolicy({
      VIVD_OPENCODE_TOOLS_ENABLE: "vivd_image_ai",
    });
    expect(enabledPolicy.enabledByName.vivd_image_ai).toBe(true);
  });

  it("applies image feature flags", () => {
    const policy = resolveStudioOpencodeToolPolicy({
      VIVD_OPENCODE_TOOL_FLAGS: JSON.stringify({
        image_ai: false,
      }),
      VIVD_ORGANIZATION_ROLE: "client_editor",
    });

    expect(policy.enabledByName.vivd_image_ai).toBe(false);
  });
});
