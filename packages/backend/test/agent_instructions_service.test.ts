import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSystemSettingValueMock } = vi.hoisted(() => ({
  getSystemSettingValueMock: vi.fn(),
}));

const { getResolvedBrandingMock } = vi.hoisted(() => ({
  getResolvedBrandingMock: vi.fn(),
}));

vi.mock("../src/services/system/SystemSettingsService", () => ({
  SYSTEM_SETTING_KEYS: {
    studioAgentInstructionsTemplate: "studio_agent_instructions_template",
  },
  getSystemSettingValue: getSystemSettingValueMock,
}));

vi.mock("../src/services/email/templateBranding", () => ({
  emailTemplateBrandingService: {
    getResolvedBranding: getResolvedBrandingMock,
  },
}));

import { agentInstructionsService } from "../src/services/agent/AgentInstructionsService";

describe("AgentInstructionsService", () => {
  beforeEach(() => {
    getSystemSettingValueMock.mockReset();
    getSystemSettingValueMock.mockResolvedValue(null);
    getResolvedBrandingMock.mockReset();
    getResolvedBrandingMock.mockResolvedValue({});
    delete process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL;
  });

  it("renders default template with source context and enabled plugins", async () => {
    process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL = "support@vivd.studio";
    const result = await agentInstructionsService.render({
      projectName: "Acme",
      source: "url",
      enabledPlugins: ["contact_form", "analytics", "newsletter"],
    });

    expect(result.templateSource).toBe("default");
    expect(result.instructions).toContain("# Project: Acme");
    expect(result.instructions).toContain("This website was created from an existing website");
    expect(result.instructions).toContain("- contact_form");
    expect(result.instructions).toContain("- analytics");
    expect(result.instructions).toContain("- newsletter");
    expect(result.instructions).toContain("Plugin-specific notes");
    expect(result.instructions).toContain(
      "Newsletter / Waitlist: Set `mode=waitlist` before generating snippets when the user asked for a waitlist.",
    );
    expect(result.instructions).toContain("Enabled plugins for this project");
    expect(result.instructions).toContain("Vivd CLI and platform features");
    expect(result.instructions).toContain(
      "The `vivd` CLI is the default interface for platform-specific actions, configuration, and inspection in this Studio runtime.",
    );
    expect(result.instructions).toContain("Start CLI discovery with `vivd --help`.");
    expect(result.instructions).toContain("USAGE");
    expect(result.instructions).toContain("DISCOVER MORE");
    expect(result.instructions).toContain(
      "Treat preview/runtime, plugin, publish/checklist, and other platform-state requests as `vivd` CLI work first, not file-search work.",
    );
    expect(result.instructions).toContain("vivd preview status");
    expect(result.instructions).toContain("vivd plugins catalog");
    expect(result.instructions).toContain("vivd plugins info <pluginId>");
    expect(result.instructions).toContain("vivd plugins snippets <pluginId> [snippetName]");
    expect(result.instructions).toContain("vivd plugins config show <pluginId>");
    expect(result.instructions).toContain("vivd plugins action <pluginId> <actionId> [args...]");
    expect(result.instructions).toContain("vivd publish targets");
    expect(result.instructions).toContain("vivd publish prepare");
    expect(result.instructions).toContain("vivd support request ...");
    expect(result.instructions).toContain("Use `vivd <command> help` to drill into the relevant area.");
    expect(result.instructions).toContain(
      "If a matching first-party plugin is enabled, prefer using it through the CLI instead of building a custom replacement.",
    );
    expect(result.instructions).toContain(
      "When a plugin exposes install markup, use `vivd plugins snippets <pluginId> [snippetName]` to fetch the exact snippet instead of recreating it by hand.",
    );
    expect(result.instructions).toContain(
      "For publish work, check `vivd publish status` and `vivd publish targets` first. Publishing requires the current saved Studio snapshot to be prepared; run `vivd publish prepare` when needed before `vivd publish deploy`.",
    );
    expect(result.instructions).toContain(
      "You must ask for explicit user permission before using the support command or contacting Vivd support on the user's behalf.",
    );
    expect(result.instructions).toContain("Structured CMS content");
    expect(result.instructions).toContain("src/content.config.ts");
    expect(result.instructions).toContain("Do not invent or reintroduce a parallel Vivd YAML schema contract");
    expect(result.instructions).toContain("Vivd adapts to Astro Content Collections internally");
    expect(result.instructions).toContain("update `src/content.config.ts`");
    expect(result.instructions).toContain("default to Astro's `Image` component");
    expect(result.instructions).toContain("does not create CMS preview ownership");
    expect(result.instructions).toContain("Derived or reformatted render points");
    expect(result.instructions).toContain(
      "src={entry.data.image}",
    );
    expect(result.instructions).toContain("Astro-relative path such as `../media/...`");
    expect(result.instructions).toContain("explicit emoji fallbacks such as `Apple Color Emoji`");
    expect(result.instructions).toContain("Before finishing a CMS-heavy generation or refactor");
    expect(result.instructions).toContain("Do not point page markup at raw filesystem-like `src/content/media/...` paths");
    expect(result.instructions).toContain("Use collection-backed CMS content selectively");
    expect(result.instructions).toContain("vivd cms validate");
    expect(result.instructions).toContain(
      "the agent may prepare a support request with `vivd support request ...` on the user's behalf",
    );
    expect(result.instructions).toContain("Git workflow boundaries");
    expect(result.instructions).toContain(".vivd/uploads/");
    expect(result.instructions).toContain(".vivd/dropped-images/");
    expect(result.instructions).toContain("Treat both as working material");
    expect(result.instructions).toContain("`src/content/media/` by default");
    expect(result.instructions).toContain("Use `public/` only for passthrough files");
    expect(result.instructions).toContain("Redirects for migrated URLs");
    expect(result.instructions).toContain("Tool Usage Contract");
    expect(result.instructions).toContain(
      "Never print pseudo tool-call text such as `[tool_call: ...]`",
    );
    expect(result.instructions).toContain(
      "If the user drops an image or preview screenshot and you need to inspect its visual content, you must use the read tool on that path first; otherwise you have not actually seen the image.",
    );
    expect(result.instructions).toContain("User messages may contain `<vivd-internal ... />`");
    expect(result.instructions).toContain(
      "the tag and path alone do not put the attachment into model context",
    );
    expect(result.instructionsHash).toHaveLength(64);
  });

  it("omits support-command guidance when support email is not configured", async () => {
    const result = await agentInstructionsService.render({
      projectName: "Acme",
      source: "url",
      enabledPlugins: ["contact_form"],
    });

    expect(result.instructions).not.toContain("vivd support request");
    expect(result.instructions).not.toContain(
      "contacting Vivd support on the user's behalf",
    );
  });

  it("includes support-command guidance when support email is configured in branding only", async () => {
    getResolvedBrandingMock.mockResolvedValue({
      supportEmail: "support@vivd.studio",
    });

    const result = await agentInstructionsService.render({
      projectName: "Acme",
      source: "url",
      enabledPlugins: ["contact_form"],
    });

    expect(result.instructions).toContain("vivd support request ...");
    expect(result.instructions).toContain(
      "the agent may prepare a support request with `vivd support request ...` on the user's behalf",
    );
    expect(result.instructions).toContain(
      "You must ask for explicit user permission before using the support command or contacting Vivd support on the user's behalf.",
    );
  });

  it("uses custom template from system settings with token replacement", async () => {
    getSystemSettingValueMock.mockResolvedValue(
      "Project={{project_name}} Plugins={{enabled_plugins}} Hints={{plugin_agent_hints}} Context={{source_context}} Help={{vivd_cli_root_help}}",
    );

    const result = await agentInstructionsService.render({
      projectName: "Beta",
      source: "scratch",
      enabledPlugins: ["newsletter"],
    });

    expect(result.templateSource).toBe("system_setting");
    expect(result.instructions).toContain(
      "Project=Beta Plugins=- newsletter Hints=- Newsletter / Waitlist: Set `mode=waitlist` before generating snippets when the user asked for a waitlist. Context=",
    );
    expect(result.instructions).toContain("Help=Work with the connected Vivd project");
    expect(result.instructions).toContain("Tool Usage Contract");
    expect(result.instructions).toContain(
      "Never print pseudo tool-call text such as `[tool_call: ...]`",
    );
  });
});
