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
    expect(result.instructions).toContain("Vivd CLI and plugin-first features");
    expect(result.instructions).toContain(
      "Use the `vivd` CLI as the default way to interact with the Vivd platform the website is running on.",
    );
    expect(result.instructions).toContain(
      "Treat publish/checklist, plugin, and other platform-state requests as `vivd` CLI work first, not file-search work.",
    );
    expect(result.instructions).toContain("vivd plugins catalog");
    expect(result.instructions).toContain("vivd plugins contact info");
    expect(result.instructions).toContain("vivd plugins contact help");
    expect(result.instructions).toContain("vivd publish checklist run");
    expect(result.instructions).toContain("vivd publish checklist show");
    expect(result.instructions).toContain("not a routine test command");
    expect(result.instructions).toContain("You can work checklist items individually");
    expect(result.instructions).toContain("asking Vivd support to activate it");
    expect(result.instructions).toContain("Git workflow boundaries");
    expect(result.instructions).toContain(".vivd/uploads/");
    expect(result.instructions).toContain(".vivd/dropped-images/");
    expect(result.instructions).toContain("Treat both as working material");
    expect(result.instructions).toContain("Redirects for migrated URLs");
    expect(result.instructions).toContain("User messages may contain `<vivd-internal ... />`");
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
