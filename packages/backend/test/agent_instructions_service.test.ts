import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSystemSettingValueMock } = vi.hoisted(() => ({
  getSystemSettingValueMock: vi.fn(),
}));

vi.mock("../src/services/system/SystemSettingsService", () => ({
  SYSTEM_SETTING_KEYS: {
    studioAgentInstructionsTemplate: "studio_agent_instructions_template",
  },
  getSystemSettingValue: getSystemSettingValueMock,
}));

import { agentInstructionsService } from "../src/services/agent/AgentInstructionsService";

describe("AgentInstructionsService", () => {
  beforeEach(() => {
    getSystemSettingValueMock.mockReset();
    getSystemSettingValueMock.mockResolvedValue(null);
  });

  it("renders default template with source context and enabled plugins", async () => {
    const result = await agentInstructionsService.render({
      projectName: "Acme",
      source: "url",
      enabledPlugins: ["contact_form", "analytics"],
    });

    expect(result.templateSource).toBe("default");
    expect(result.instructions).toContain("# Project: Acme");
    expect(result.instructions).toContain("This website was created from an existing website");
    expect(result.instructions).toContain("- contact_form");
    expect(result.instructions).toContain("- analytics");
    expect(result.instructions).toContain("Enabled plugins for this project");
    expect(result.instructions).toContain("Plugin-first features");
    expect(result.instructions).toContain("vivd_plugins_catalog");
    expect(result.instructions).toContain("asking Vivd support to activate it");
    expect(result.instructions).toContain("Git workflow boundaries");
    expect(result.instructionsHash).toHaveLength(64);
  });

  it("uses custom template from system settings with token replacement", async () => {
    getSystemSettingValueMock.mockResolvedValue(
      "Project={{project_name}} Plugins={{enabled_plugins}} Context={{source_context}}",
    );

    const result = await agentInstructionsService.render({
      projectName: "Beta",
      source: "scratch",
      enabledPlugins: [],
    });

    expect(result.templateSource).toBe("system_setting");
    expect(result.instructions).toBe("Project=Beta Plugins=None Context=");
  });
});
